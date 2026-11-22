"""Signing with a token (a software token here) and checking the result the way the server will."""

import io

import pytest
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext
from asn1crypto import x509 as ax
from cryptography.hazmat.primitives import serialization

from flourishive_desktop import appearance
from flourishive_desktop.errors import SigningFailed
from flourishive_desktop.signing import SignOptions, sign_pdf
from flourishive_desktop.tokens import TokenSession, list_certificates, list_tokens

BOX = (321.28, 70.0, 535.28, 118.0)


def options(**kw):
    kw.setdefault("box", BOX)
    return SignOptions(reason="Issued by FS/INT/2026/0012", timestamp_url="http://tsa.invalid", **kw)


def trust(pki):
    return ValidationContext(trust_roots=[ax.Certificate.load(pki.root.public_bytes(serialization.Encoding.DER))], allow_fetching=False)


def test_the_token_is_found_and_its_certificate_read(token, pki):
    assert [t.label for t in list_tokens(token.library)] == [token.label]
    certs = list_certificates(token.library, token.label, token.pin)
    assert len(certs) == 1 and certs[0].common_name == "Desktop Test Signer" and certs[0].signing_capable and not certs[0].expired


def test_a_wrong_pin_is_explained_and_does_not_open_the_token(token):
    with pytest.raises(SigningFailed, match="PIN is not correct"):
        with TokenSession(token.library, "000000", token_label=token.label):
            pass


def test_signing_adds_a_valid_time_stamped_signature_without_touching_the_original(token, pki, pdf, timestamper):
    with TokenSession(token.library, token.pin, token_label=token.label, cert_id=token.cert_id) as t:
        signed = sign_pdf(pdf, t.signer, options(), timestamper=timestamper)
    assert signed.startswith(pdf) and len(signed) > len(pdf)  # an addition at the end, never a rewrite
    sigs = PdfFileReader(io.BytesIO(signed)).embedded_signatures
    assert len(sigs) == 1
    status = validate_pdf_signature(sigs[0], trust(pki))
    assert status.intact and status.valid and status.trusted
    assert status.timestamp_validity is not None and status.timestamp_validity.intact
    assert status.md_algorithm == "sha256"
    assert signed.count(b"/ByteRange") == 1  # exactly one new signature: no document time-stamp on top


def test_a_second_signature_leaves_the_first_valid(token, pki, pdf, timestamper):
    with TokenSession(token.library, token.pin, token_label=token.label) as t:
        once = sign_pdf(pdf, t.signer, options(field_name="First"), timestamper=timestamper)
        twice = sign_pdf(once, t.signer, options(field_name="Second", box=(60, 130, 274, 178)), timestamper=timestamper)
    assert twice.startswith(once)
    for sig in PdfFileReader(io.BytesIO(twice)).embedded_signatures:
        assert validate_pdf_signature(sig, trust(pki)).intact


def test_one_login_signs_many_letters(token, pki, pdf, timestamper):
    with TokenSession(token.library, token.pin, token_label=token.label) as t:
        out = [sign_pdf(pdf, t.signer, options(), timestamper=timestamper) for _ in range(3)]
    assert len({bytes(o) for o in out}) == 3  # each signature is its own
    assert all(validate_pdf_signature(PdfFileReader(io.BytesIO(o)).embedded_signatures[0], trust(pki)).intact for o in out)


def test_the_stamp_is_on_the_page_and_contains_the_tick_and_the_signer(token, pdf, timestamper):
    with TokenSession(token.library, token.pin, token_label=token.label) as t:
        signed = sign_pdf(pdf, t.signer, options(), timestamper=timestamper)
    reader = PdfFileReader(io.BytesIO(signed))
    annots = reader.root["/Pages"]["/Kids"][0].get_object()["/Annots"]
    widget = annots[-1].get_object()
    assert [round(float(x), 2) for x in widget["/Rect"]] == list(BOX)
    assert b"Digitally signed" in signed.replace(b"\\040", b" ") or b"Digitally" in signed  # the text is drawn in the stamp
    assert appearance.emblem_operators() in signed or b"0.184 0.49 0.322 RG" in signed  # the tick's green is in the file


def test_an_invisible_signature_is_possible_too(token, pki, pdf, timestamper):
    with TokenSession(token.library, token.pin, token_label=token.label) as t:
        signed = sign_pdf(pdf, t.signer, options(visible=False), timestamper=timestamper)
    assert validate_pdf_signature(PdfFileReader(io.BytesIO(signed)).embedded_signatures[0], trust(pki)).intact
    assert b"Digitally signed" not in signed
