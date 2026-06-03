# Rapport de PFE — labConnect

Source LaTeX du rapport de Projet de Fin d'Études, mise en forme conforme au **Guide ID.145 v2 (SUP'COM, mai 2026)**.

## Compilation

Aucun outil TeX n'est installé localement. Deux options :

### Option 1 — Overleaf (recommandé, zéro install)

1. Crée un nouveau projet « Blank Project ».
2. Glisse-dépose `main.tex` et le dossier `images/` (vide pour l'instant).
3. Ajoute progressivement tes captures dans `images/` et change les `\placeholderFigure{...}` par des `\includegraphics`.
4. « Recompile » deux fois (pour la table des matières).

### Option 2 — TeX Live ou MiKTeX local

```bash
# Installation Windows (MiKTeX) : https://miktex.org/download
# Une fois installé :
cd Rapport-PFE
pdflatex main.tex   # première passe
pdflatex main.tex   # deuxième passe (TOC, listes)
```

## Où mettre tes captures

Toutes les figures du rapport sont actuellement des **placeholders** encadrés avec une légende décrivant ce que la capture doit contenir. Cherche `\placeholderFigure` dans `main.tex` pour les retrouver. Pour chaque emplacement, suis ce flux :

1. Prends la capture (PNG ou JPG haute résolution, pas de photocopie scannée — exigence du § 1 du guide).
2. Dépose-la dans `images/` avec le nom suggéré dans la troisième paramètre du `\placeholderFigure` (ex : `walkin-modal.png`).
3. Remplace
   ```latex
   \placeholderFigure{Modal Walk-in dans l'application web}{walkin-modal}{capture écran — ...}
   ```
   par
   ```latex
   \begin{figure}[ht] \centering
     \includegraphics[width=0.8\linewidth]{walkin-modal}
     \caption{Modal Walk-in dans l'application web}
     \label{fig:walkin-modal}
   \end{figure}
   ```

### Inventaire des captures attendues

| Chapitre | Label | Sujet de la capture |
|---|---|---|
| 1 | `contexte-mauritanie-carte` | Carte de Nouakchott avec laboratoires partenaires |
| 1 | `contexte-poste-secretaire` | Photo terrain : poste de travail mixte papier/écran |
| 1 | `architecture-macro` | Schéma d'architecture macroscopique |
| 2 | `er-diagram` | Diagramme entité-relation (dbdiagram.io ou draw.io) |
| 2 | `statemachine-order` | Machine à états du TestOrder |
| 2 | `seq-jwt` | Diagramme de séquence du login JWT |
| 3 | `repo-tree` | Arborescence VS Code du dépôt |
| 3 | `walkin-modal` | Modal « Nouvelle analyse au comptoir » |
| 3 | `result-entry` | Modal de saisie résultat technicien |
| 3 | `validation-modal` | Modal de validation avec correction biologiste |
| 3 | `invoice-modal` | Modal facture détaillée avec split CNAM |
| 3 | `questionnaire-flow` | Questionnaire : édition + saisie + affichage validation |
| 3 | `stats-screen` | Écran Statistiques avec KPI + bar charts |
| 3 | `inventory-screen` | Écran Inventaire + modal mouvement |
| 4 | `build-terminal` | Terminal avec build Vite réussi |
| 4 | `scenario1-invoice` | Facture finale du scénario CNAM 80 % |
| 4 | `capture-dashboard` | Tableau de bord chef de labo |
| 4 | `capture-analyses-validate` | Onglet « À valider » côté biologiste |
| 4 | `capture-mobile-home` | App mobile patient — accueil |

## À personnaliser avant la soutenance

Cherche les `\underline{\hspace{...}}` dans `main.tex` — chaque trait est une zone à remplir :

- Option d'ingénieur (page de garde)
- Ton nom et celui des encadrants
- Sigle et nom de l'établissement d'accueil
- Année universitaire

Vérifie aussi les sections personnelles :
- **Dédicaces** (juste après la page de garde) — actuellement génériques, à retoucher selon ta sensibilité.
- **Avant-propos / Remerciements** — à adapter à tes vrais encadrants et collègues.

## Conformité au Guide ID.145

- [x] Page de garde au format SUP'COM
- [x] Interligne 1.3, marges adaptées à la reliure (intérieure 2.8 cm)
- [x] Texte justifié
- [x] Polices limitées (Latin Modern + mono pour le code)
- [x] Figures et tableaux numérotés et titrés
- [x] Références bibliographiques au format `[N]` dans le texte
- [x] Section « Déclaration d'usage d'outils d'IA générative » dans les annexes (§ 4 du guide)
- [x] Structure obligatoire respectée : résumé, avant-propos, sommaire, listes (figures/tableaux/abréviations), introduction générale, chapitres, conclusion, annexes, bibliographie
