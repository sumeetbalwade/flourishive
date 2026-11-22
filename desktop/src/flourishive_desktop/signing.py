"""Signing one PDF: an invisible-to-the-text, visible-as-a-stamp certificate signature added on top."""

from __future__ import annotations

import io
from dataclasses import dataclass

from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers, timestamps
from pyhanko.sign.signers.pdf_signer import PdfSigner

from . import appearance
from .api import Claim
from .errors import SigningFailed


@dataclass(frozen=True)
class SignOptions:
    reason: str
    timestamp_url: str
    box: tuple[float, float, float, float]
    page: int = 0
    visible: bool = True
    field_name: str = "HRSignature"


def options_from(claim: Claim) -> SignOptions:
    return SignOptions(
        reason=claim.reason,
        timestamp_url=claim.timestamp_url,
        box=claim.appearance.box,
        page=claim.appearance.page,
        visible=claim.appearance.visible,
    )


def sign_pdf(
    pdf: bytes,
    signer: signers.Signer,
    options: SignOptions,
    *,
    timestamper: timestamps.TimeStamper | None = None,
) -> bytes:
    """Adds one signature as an incremental update, so the file we were sent stays byte for byte intact.

    The signature carries a CA time-stamp (the server requires one) and no long-term-validation
    update (that would add a second, document time-stamp signature, which the server refuses).
    """
    ts = timestamper or timestamps.HTTPTimeStamper(options.timestamp_url, timeout=20)
    meta = signers.PdfSignatureMetadata(
        field_name=options.field_name,
        md_algorithm="sha256",
        subfilter=fields.SigSeedSubFilter.PADES,
        reason=options.reason,
        embed_validation_info=False,
        use_pades_lta=False,
    )
    pdf_signer = PdfSigner(
        meta,
        signer=signer,
        timestamper=ts,
        stamp_style=appearance.stamp_style() if options.visible else None,
        new_field_spec=fields.SigFieldSpec(
            options.field_name,
            on_page=options.page,
            box=options.box if options.visible else None,
        ),
    )
    try:
        writer = IncrementalPdfFileWriter(io.BytesIO(pdf))
        out = io.BytesIO()
        pdf_signer.sign_pdf(writer, output=out)
    except Exception as exc:  # token, network and PDF errors all surface here
        from .tokens import _friendly  # noqa: PLC0415
        import pkcs11  # noqa: PLC0415

        if isinstance(exc, pkcs11.exceptions.PKCS11Error):
            raise _friendly(exc) from exc
        if "timestamp" in str(exc).lower() or exc.__class__.__name__ in {"TimeStampError", "ConnectError"}:
            raise SigningFailed("The time-stamp server could not be reached. Check the internet connection.") from exc
        raise SigningFailed(f"The document could not be signed ({exc.__class__.__name__}).") from exc
    return out.getvalue()
