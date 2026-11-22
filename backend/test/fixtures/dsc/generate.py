"""
Makes the TEST-ONLY certificates and signed PDFs used by the DSC validator tests.
Nothing here is secret: the keys only exist to build fixtures. Run from this folder:

  python generate.py certs          # root, intermediate, leaf, TSA, seal, untrusted and expired leaf
  (then seal the base PDF, see README.md)
  python generate.py sign           # signs input.pdf in several ways with pyHanko

Needs: pip install pyhanko pyhanko-certvalidator cryptography
"""
import datetime, sys
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID, AuthorityInformationAccessOID

UTC = datetime.timezone.utc
def key(): return rsa.generate_private_key(65537, 2048)
def name(cn, o="Test Authority"): return x509.Name([x509.NameAttribute(NameOID.ORGANIZATION_NAME, o), x509.NameAttribute(NameOID.COMMON_NAME, cn)])
def save(path, obj):
    if isinstance(obj, x509.Certificate): open(path, "wb").write(obj.public_bytes(serialization.Encoding.PEM))
    else: open(path, "wb").write(obj.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))

def issue(subject, pub, issuer_name, issuer_key, years_from, years_to, ca=False, path_len=None, usage=None, eku=None, ocsp=None):
    b = (x509.CertificateBuilder().subject_name(subject).issuer_name(issuer_name).public_key(pub)
         .serial_number(x509.random_serial_number()).not_valid_before(years_from).not_valid_after(years_to)
         .add_extension(x509.BasicConstraints(ca=ca, path_length=path_len), True))
    if usage: b = b.add_extension(usage, True)
    if eku: b = b.add_extension(x509.ExtendedKeyUsage(eku), True)
    if ocsp: b = b.add_extension(x509.AuthorityInformationAccess([x509.AccessDescription(AuthorityInformationAccessOID.OCSP, x509.UniformResourceIdentifier(ocsp))]), False)
    return b.sign(issuer_key, hashes.SHA256())

def ku(**k):
    d = dict(digital_signature=False, content_commitment=False, key_encipherment=False, data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False); d.update(k)
    return x509.KeyUsage(**d)

def certs():
    now = datetime.datetime.now(UTC)
    old, far = now - datetime.timedelta(days=365), now + datetime.timedelta(days=3650)
    rk, ik, lk, tk, sk = key(), key(), key(), key(), key()
    root = issue(name("Test Root CA"), rk.public_key(), name("Test Root CA"), rk, old, far, ca=True, usage=ku(key_cert_sign=True, crl_sign=True))
    inter = issue(name("Test Issuing CA"), ik.public_key(), root.subject, rk, old, far, ca=True, path_len=0, usage=ku(key_cert_sign=True, crl_sign=True))
    leaf = issue(name("Noah Brooks (Test DSC)", "Flourisense Test"), lk.public_key(), inter.subject, ik, old, far, usage=ku(digital_signature=True, content_commitment=True), ocsp="http://ocsp.test.invalid/")
    tsa = issue(name("Test Time Stamp Authority"), tk.public_key(), inter.subject, ik, old, far, usage=ku(digital_signature=True), eku=[ExtendedKeyUsageOID.TIME_STAMPING])
    seal = issue(name("Flourishive Document Seal", "Flourishive"), sk.public_key(), name("Flourishive Document Seal", "Flourishive"), sk, old, far, usage=ku(digital_signature=True, content_commitment=True))
    # a leaf whose dates ended long ago (like the expired DSC), still issued by the trusted CA
    ek = key()
    expired = issue(name("Noah Brooks (Expired Test DSC)", "Flourisense Test"), ek.public_key(), inter.subject, ik, now - datetime.timedelta(days=900), now - datetime.timedelta(days=200), usage=ku(digital_signature=True, content_commitment=True), ocsp="http://ocsp.test.invalid/")
    # a different, untrusted authority
    urk, ulk = key(), key()
    uroot = issue(name("Untrusted Root"), urk.public_key(), name("Untrusted Root"), urk, old, far, ca=True, usage=ku(key_cert_sign=True))
    uleaf = issue(name("Mallory (Untrusted)", "Nobody"), ulk.public_key(), uroot.subject, urk, old, far, usage=ku(digital_signature=True, content_commitment=True))
    for n, o in dict(root=root, inter=inter, leaf=leaf, tsa=tsa, seal=seal, expired=expired, uroot=uroot, uleaf=uleaf).items(): save(f"{n}.pem", o)
    for n, o in dict(root=rk, inter=ik, leaf=lk, tsa=tk, seal=sk, expired=ek, uroot=urk, uleaf=ulk).items(): save(f"{n}.key", o)
    import os; os.makedirs("trust", exist_ok=True); save("trust/root.pem", root)
    print("certs written")

def sign():
    from pyhanko.sign import signers, fields, timestamps
    from pyhanko.sign.fields import SigFieldSpec
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko_certvalidator.registry import SimpleCertificateStore
    from pyhanko.keys import load_cert_from_pemder, load_private_key_from_pemder
    from asn1crypto import keys as ak

    inter, root = load_cert_from_pemder("inter.pem"), load_cert_from_pemder("root.pem")
    store = SimpleCertificateStore(); store.register(inter); store.register(root)
    tsa_cert = load_cert_from_pemder("tsa.pem"); tsa_key = load_private_key_from_pemder("tsa.key", None)
    def ts(): return timestamps.DummyTimeStamper(tsa_cert, tsa_key, certs_to_embed=store)
    def go(out, leaf, ca_files, timestamper, field="DSC"):
        s = signers.SimpleSigner.load(f"{leaf}.key", f"{leaf}.pem", ca_chain_files=ca_files)
        w = IncrementalPdfFileWriter(open("input.pdf", "rb"))
        fields.append_signature_field(w, SigFieldSpec(field, on_page=0, box=(60, 40, 260, 90)))
        meta = signers.PdfSignatureMetadata(field_name=field, reason="Issued by HR lead", md_algorithm="sha256", use_pades_lta=False)
        open(out, "wb").write(signers.PdfSigner(meta, signer=s, timestamper=timestamper).sign_pdf(w).read())
        print("wrote", out)
    go("signed-ok.pdf", "leaf", ["inter.pem", "root.pem"], ts())
    go("signed-no-timestamp.pdf", "leaf", ["inter.pem", "root.pem"], None)
    go("signed-expired.pdf", "expired", ["inter.pem", "root.pem"], ts())
    go("signed-untrusted.pdf", "uleaf", ["uroot.pem"], ts())

if __name__ == "__main__":
    {"certs": certs, "sign": sign}[sys.argv[1]]()
