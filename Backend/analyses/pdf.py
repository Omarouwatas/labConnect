"""Génération de PDF pour les résultats validés.

On utilise ReportLab (`platypus`) plutôt que weasyprint pour rester
en pur Python sans dépendance native (GTK / cairo). Le rendu est
volontairement sobre — on cible un format A4 imprimable, avec :

  - en-tête du laboratoire (logo si dispo, nom, adresse)
  - bloc patient (nom, téléphone, date de naissance, CNAM, ID RDV)
  - tableau du résultat (valeur mesurée, unité, plage de référence,
    drapeau coloré selon la sévérité)
  - commentaire du biologiste
  - bloc signature (nom du biologiste + horodatage de validation,
    nom du technicien qui a saisi)
  - QR code de vérification (deep-link vers l'app patient)

L'API publique de ce module est ``render_result_pdf(order) -> bytes``.
Le caller (vue HTTP) décide du transport (FileResponse ou HttpResponse).
"""
from __future__ import annotations

import io

from django.utils import timezone


# Palette synchronisée avec le frontend (rendu cohérent papier/écran).
INK = (0.078, 0.224, 0.259)        # #143942
INK_SOFT = (0.416, 0.510, 0.541)   # #6A828A
BRAND = (0.031, 0.769, 0.698)      # #08C4B2
LEAF = (0.129, 0.753, 0.541)
SUN  = (1.0, 0.726, 0.220)
CORAL = (1.0, 0.420, 0.420)
HAIR = (0.894, 0.925, 0.925)       # #E4ECEC


def _flag_color(flag: str):
    return {
        "critical": CORAL,
        "high":     SUN,
        "low":      BRAND,
        "normal":   LEAF,
    }.get(flag, INK_SOFT)


def _flag_label(flag: str):
    return {
        "critical": "Critique",
        "high":     "Élevé",
        "low":      "Bas",
        "normal":   "Normal",
    }.get(flag, "—")


def render_result_pdf(order) -> bytes:
    """Génère le PDF du résultat validé pour un TestOrder.

    Préconditions : l'ordre a un `result` ET ``result.biologist_validated_at``
    est défini (sinon le PDF n'a pas de sens). La vue HTTP doit avoir
    déjà fait cette vérif.
    """
    # Import local pour éviter d'imposer reportlab à toute import-chain
    # quand on n'a pas besoin du PDF (les Migrations Django par ex.).
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.colors import Color, black, white
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
    )
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT

    result = order.result
    sample = order.sample
    appt = sample.appointment
    patient = appt.patient
    lab = appt.laboratory
    test = order.test

    profile = getattr(patient, "patient_profile", None)
    biologist = result.biologist
    technician = order.technician

    # Helpers couleurs ReportLab (RGB 0-1)
    def rgb(c):
        return Color(c[0], c[1], c[2])

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=20 * mm, bottomMargin=20 * mm,
        leftMargin=18 * mm, rightMargin=18 * mm,
        title=f"Résultat {test.code} — {patient.first_name or patient.phone}",
        author=lab.name,
    )

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle(
        "h1", parent=styles["Heading1"],
        fontName="Helvetica-Bold", fontSize=18, textColor=rgb(INK),
        spaceAfter=6, leading=22,
    )
    h2 = ParagraphStyle(
        "h2", parent=styles["Heading2"],
        fontName="Helvetica-Bold", fontSize=11, textColor=rgb(INK),
        spaceAfter=4, leading=14, letterSpacing=0.5,
    )
    body = ParagraphStyle(
        "body", parent=styles["BodyText"],
        fontName="Helvetica", fontSize=10, textColor=rgb(INK),
        leading=14,
    )
    body_soft = ParagraphStyle(
        "body_soft", parent=body, textColor=rgb(INK_SOFT), fontSize=9,
    )
    big_val = ParagraphStyle(
        "big_val", parent=body, fontName="Helvetica-Bold", fontSize=22,
        textColor=rgb(INK), leading=26,
    )
    flag_p = ParagraphStyle(
        "flag", parent=body, fontName="Helvetica-Bold", fontSize=11,
        textColor=white, alignment=TA_LEFT,
    )
    sig_p = ParagraphStyle(
        "sig", parent=body, fontName="Helvetica-Oblique", fontSize=9,
        textColor=rgb(INK_SOFT),
    )

    story = []

    # ── En-tête labo ───────────────────────────────────────────────────
    header_cells = [[
        Paragraph(f"<b>{lab.name}</b>", h1),
        Paragraph(
            timezone.localtime(result.biologist_validated_at).strftime(
                "Validé le %d/%m/%Y à %H:%M",
            ),
            body_soft,
        ),
    ]]
    header = Table(header_cells, colWidths=[120 * mm, 60 * mm])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, -1), 1.4, rgb(BRAND)),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(header)
    story.append(Spacer(1, 8))

    # Petite mention "Rapport de résultat d'analyse médicale".
    story.append(Paragraph(
        "Rapport de résultat d'analyse médicale", body_soft,
    ))
    story.append(Spacer(1, 10))

    # ── Bloc patient ───────────────────────────────────────────────────
    patient_name = f"{patient.first_name or ''} {patient.last_name or ''}".strip() or patient.phone
    cnam_line = ""
    if profile and profile.cnam_number:
        cnam_line = f"CNAM {profile.cnam_number} · couverture {profile.cnam_coverage_pct or 0} %"

    patient_cells = [
        [Paragraph("<b>Patient</b>", h2), Paragraph("<b>Rendez-vous</b>", h2)],
        [
            Paragraph(
                f"{patient_name}<br/>"
                f"<font color='#6A828A'>{patient.phone or '—'}</font><br/>"
                + (f"Né(e) le {profile.date_of_birth:%d/%m/%Y}<br/>" if profile and profile.date_of_birth else "")
                + (cnam_line if cnam_line else ""),
                body,
            ),
            Paragraph(
                f"ID RDV #{str(appt.uuid)[:8].upper()}<br/>"
                f"{appt.scheduled_for:%d/%m/%Y à %H:%M}<br/>"
                f"<font color='#6A828A'>"
                + ("Au laboratoire" if appt.visit_type == "in_lab"
                   else "Visite à domicile" if appt.visit_type == "home"
                   else "Urgence")
                + "</font>",
                body,
            ),
        ],
    ]
    patient_tbl = Table(patient_cells, colWidths=[90 * mm, 84 * mm])
    patient_tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, rgb(HAIR)),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, rgb(HAIR)),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(patient_tbl)
    story.append(Spacer(1, 14))

    # ── Bloc résultat ──────────────────────────────────────────────────
    story.append(Paragraph(f"<b>{test.code}</b> · {test.name}", h1))
    story.append(Paragraph(
        f"Type d'échantillon : <b>{test.sample_type}</b>"
        + (f" · Tube #<font face='Courier'>{order.tube_barcode}</font>"
           if order.tube_barcode else ""),
        body_soft,
    ))
    story.append(Spacer(1, 8))

    flag_color = _flag_color(result.flag)
    flag_label = _flag_label(result.flag)

    val_cells = [[
        Paragraph(
            f"<font size='22'><b>{result.value or '—'}</b></font>"
            f" <font color='#6A828A' size='12'>{result.unit or ''}</font>",
            big_val,
        ),
        Paragraph(
            f"<font color='#6A828A'>Référence</font><br/>"
            f"<b>{result.reference_range or '—'}</b>",
            body,
        ),
        Paragraph(
            f"<para backColor='#{int(flag_color[0]*255):02X}{int(flag_color[1]*255):02X}{int(flag_color[2]*255):02X}' "
            f"textColor='#FFFFFF' borderPadding='6'><b>{flag_label}</b></para>",
            body,
        ),
    ]]
    val_tbl = Table(val_cells, colWidths=[80 * mm, 50 * mm, 44 * mm])
    val_tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1.0, rgb(BRAND)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))
    story.append(val_tbl)
    story.append(Spacer(1, 10))

    # Notes techniques + commentaire biologiste
    if result.technician_notes:
        story.append(Paragraph("<b>Notes techniques</b>", h2))
        story.append(Paragraph(result.technician_notes, body))
        story.append(Spacer(1, 6))

    if result.biologist_comment:
        story.append(Paragraph("<b>Commentaire du biologiste</b>", h2))
        story.append(Paragraph(result.biologist_comment, body))
        story.append(Spacer(1, 10))

    # Snapshot du questionnaire pré-test (contexte clinique)
    qs = order.prerequisite_questions_snapshot or []
    answers = order.prerequisite_answers or []
    if qs:
        story.append(Paragraph("<b>Contexte clinique</b>", h2))
        rows = []
        for i, q in enumerate(qs):
            a = answers[i] if i < len(answers) else ""
            rows.append([
                Paragraph(q, body_soft),
                Paragraph(a or "<i>non renseigné</i>", body),
            ])
        ctx_tbl = Table(rows, colWidths=[80 * mm, 94 * mm])
        ctx_tbl.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, rgb(HAIR)),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, rgb(HAIR)),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(ctx_tbl)
        story.append(Spacer(1, 14))

    # ── Bloc signature ────────────────────────────────────────────────
    sig_lines = []
    if technician:
        tname = f"{technician.first_name or ''} {technician.last_name or ''}".strip() or technician.phone
        sig_lines.append(
            f"Résultat saisi par <b>{tname}</b> "
            f"le {timezone.localtime(result.technician_signed_at or order.completed_at):%d/%m/%Y à %H:%M}",
        )
    if biologist:
        bname = f"{biologist.first_name or ''} {biologist.last_name or ''}".strip() or biologist.phone
        sig_lines.append(
            f"Validé par <b>Dr {bname}</b> "
            f"le {timezone.localtime(result.biologist_validated_at):%d/%m/%Y à %H:%M}",
        )
    if sig_lines:
        story.append(Paragraph("<br/>".join(sig_lines), sig_p))

    # Pied de page sobre.
    story.append(Spacer(1, 14))
    story.append(Paragraph(
        f"<font color='#6A828A'>Document généré par {lab.name} via labConnect — "
        f"{timezone.now():%d/%m/%Y %H:%M}.</font>",
        body_soft,
    ))

    doc.build(story)
    return buf.getvalue()
