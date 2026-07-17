# 🎬 CinéTrack — Suivi de séries & films

Application web installable sur iPhone (**PWA**) pour suivre vos séries et films :
recherchez un titre, ajoutez-le à votre liste, puis **cochez saison par saison
(et épisode par épisode) ce que vous avez vu**.

- **Base de données séries** : [TVmaze](https://www.tvmaze.com/) — gratuite,
  **sans aucune clé ni compte à créer**, mise à jour en continu. Les nouvelles
  saisons/épisodes apparaissent automatiquement.
- **Base de données films** : [OMDb](https://www.omdbapi.com/) (données IMDb) —
  clé gratuite obtenue par simple e-mail, sans justification (facultative : sans
  elle, l'app fonctionne pour les séries).
- Titres et résumés sont fournis en anglais (ou version originale) par ces sources.
- **Vos données** : stockées uniquement sur votre appareil (localStorage).
  Aucune inscription, aucun serveur à vous. Export/restauration possible dans Réglages.
- **Hors-ligne** : l'app s'ouvre même sans connexion (votre liste et votre suivi
  restent accessibles ; seules la recherche et l'actualisation demandent internet).

---

## 1. Héberger l'application (nécessaire pour l'installer sur iPhone)

Une PWA doit être servie en **HTTPS**. Deux options gratuites :

### Option A — GitHub Pages (recommandé)

1. Créez un compte sur <https://github.com> et un dépôt (par ex. `cinetrack`).
2. Envoyez-y le contenu de ce dossier (via l'upload web de GitHub ou `git push`).
3. Dans le dépôt : **Settings → Pages → Source : Deploy from a branch**,
   branche `main`, dossier `/ (root)` → **Save**.
4. Après ~1 minute, l'app est disponible sur
   `https://<votre-pseudo>.github.io/cinetrack/`.

Pour mettre à jour l'app plus tard : remplacez les fichiers dans le dépôt.

### Option B — Netlify

1. Compte gratuit sur <https://app.netlify.com>.
2. Glissez-déposez le dossier `cinetrack` sur <https://app.netlify.com/drop>.
3. Netlify vous donne une URL `https://….netlify.app`.

### Tester en local (sur ce PC, optionnel)

```powershell
# avec Node.js installé :
npx serve cinetrack
# ou avec Python :
python -m http.server 8000 --directory cinetrack
```

Puis ouvrez `http://localhost:3000` (ou `:8000`).

## 2. Installer sur l'iPhone

1. Ouvrez l'URL de l'app dans **Safari** (pas Chrome).
2. Touchez le bouton **Partager** (carré avec flèche vers le haut).
3. Choisissez **« Sur l'écran d'accueil »** puis **Ajouter**.
4. L'icône CinéTrack apparaît : l'app s'ouvre en plein écran, comme une app native.

> ⚠️ **Important** : sur iOS, l'app installée et l'onglet Safari ont des stockages
> **séparés**. Installez d'abord, puis saisissez votre clé et vos séries **dans
> l'app installée**. Si vous avez déjà des données dans Safari, transférez-les via
> Réglages → Exporter (dans Safari) puis Réglages → Restaurer (dans l'app).

## 3. (Facultatif) Clé OMDb pour les films — 30 secondes

**Les séries fonctionnent immédiatement, sans aucune clé.** Pour rechercher
aussi des films, il faut une clé OMDb gratuite :

1. Ouvrez <https://www.omdbapi.com/apikey.aspx>.
2. Choisissez **FREE** (1 000 requêtes/jour, largement suffisant) et entrez
   votre adresse e-mail — aucune justification demandée.
3. Cliquez le **lien d'activation** reçu par e-mail (sinon la clé est refusée).
4. Dans l'app (installée), onglet **Réglages** → collez la clé → **Enregistrer**.
   Un « ✓ Clé valide » confirme que la recherche de films est active.

> La clé reste sur votre appareil ; elle n'est envoyée qu'à OMDb.

## 4. Utilisation

- **Recherche** : tapez un titre → touchez un résultat pour ouvrir sa fiche,
  ou touchez **+** pour l'ajouter directement à votre liste.
- **Fiche série** : cochez la case d'une **saison** pour tout marquer vu,
  ou dépliez la saison pour cocher **épisode par épisode**.
  Une case « – » indique une saison partiellement vue.
- **Ma liste** : onglets Séries/Films, filtres « En cours » / « Terminé »,
  barre de progression par série.
- **Actualiser** : la fiche se met à jour automatiquement à l'ouverture ;
  le bouton ⟳ force le rechargement (nouvelles saisons, etc.).
- **Réglages** : clé OMDb (films), export/restauration de sauvegarde, remise à zéro.

## 5. Sauvegarde

Vos données vivent dans le navigateur de l'iPhone. Avant de changer de téléphone
(ou pour être tranquille), faites **Réglages → Exporter la sauvegarde** : un
fichier JSON est téléchargé (et copié dans le presse-papier). Pour restaurer :
**Réglages → Restaurer une sauvegarde**.

## Structure du projet

```
cinetrack/
├── index.html            # structure de l'app
├── css/styles.css        # thème sombre, adapté iPhone (safe areas)
├── js/app.js             # logique : TVmaze/OMDb, bibliothèque, suivi, réglages
├── sw.js                 # service worker (hors-ligne + cache des affiches)
├── manifest.webmanifest  # manifeste PWA (nom, icônes, plein écran)
├── icons/                # icônes 180/192/512 px
└── README.md
```

---

*Données séries : [TVmaze](https://www.tvmaze.com/) (licence CC BY-SA) ·
Données films : [OMDb API](https://www.omdbapi.com/).*
