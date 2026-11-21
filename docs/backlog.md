# Calendarr : backlog

Objectif : le « WAF » (facteur d'approbation de l'épouse). Le mercredi après-midi, elle ouvre l'app sur
l'iPad, le téléphone ou l'écran de la cuisine, comprend en 2 secondes ce qu'on regarde, et le lance.

Décisions prises (2026-11-21) :

- **Écrans** : tout doit s'adapter, PC, iPhone, iPad et écran d'assistant dans la cuisine.
- **Lecture** : Infuse sur l'Apple TV.
- **Âge** : affichage simple, « Tous publics », « Dès 12 ans »…

## Fait

- [x] Page d'accueil **Ce soir** : le prochain programme en grand, avec ▶ Regarder, Autre idée et Pas ce
  soir, puis les trois suivants.
- [x] **▶ Regarder** sur chaque carte : Jellyfin, Infuse sur l'appareil (`infuse://`), ou « Sur l'Apple
  TV » qui indique où trouver le titre et l'épisode dans Infuse.
- [x] **App installable** (PWA) : manifeste, icônes PNG, plein écran sur iOS, écran toujours allumé.
- [x] **Français partout** : âge conseillé, « Pas cette fois », bandeau simplifié pour la famille.
- [x] **Mobile** : actions de la semaine dans un menu ⋯, cartes compactes ; sur grand écran, les cartes
  de la semaine remplissent la largeur.
- [x] **Écran de cuisine** (`/mur`) : lien secret, lecture seule, horloge, « Ce soir » et la suite, mise à
  jour automatique, toutes tailles d'écran.
- [x] **Collection Jellyfin par semaine** (« Calendarr · Semaine du 23 novembre ») : seulement ce qui
  reste à voir cette semaine, les jours passés en sortent, l'ancienne semaine est supprimée le lundi.
- [x] Comptes et rôles (administrateur, famille), connexions saisies dans l'app.

## P1 : surprise et retour d'information

- [ ] **Surprends-moi en swipe** : pile de cartes plein écran. Les gestes, avec des boutons équivalents
  pour l'accessibilité :
  - → oui : le titre va dans le prochain créneau compatible ;
  - ← non : il n'est plus jamais reproposé ;
  - ↑ déjà vu : il est marqué vu ;
  - ↓ plus tard.

  Un bouton annule le dernier swipe.
- [ ] **Match à deux** : chacun swipe de son côté ; « On a un match » ne montre que les titres aimés par les
  deux.
- [ ] **Mémoire des choix** : refus, « déjà vu », goûts, lus par le planificateur (exclusions, genres
  favorisés ou évités).
- [ ] **Marquer vu depuis l'app**, renvoyé à Jellyfin, pour que l'historique soit juste.
- [ ] **Profils d'historique** : un utilisateur Jellyfin par public (parents, enfants).

## P2 : intégration Jellyfin / Infuse

- [ ] Lien de lecture dans l'événement du calendrier iCloud.
- [ ] À vérifier sur l'Apple TV : la collection de la semaine apparaît-elle bien dans Infuse ?
- [ ] Tester les liens `infuse://` (films, séries, épisodes) sur iPhone et iPad.
- [ ] Jaquettes servies depuis le NAS (Jellyfin) avec un cache, au lieu d'Internet (TMDB).

## P3 : plus tard

- [ ] Seerr : proposer des titres hors bibliothèque et les demander en un geste.
- [ ] Langue audio : exclure les titres sans piste française pour le public enfants.
- [ ] Notification 15 minutes avant (ntfy ou notification web), en plus de l'alarme du calendrier.
- [ ] Statistiques de la famille : temps d'écran prévu, soirées sans écran tenues.

## Idée : sorties cinéma et « se mettre à jour » (2026-11-21)

Synchroniser l'app avec les sorties cinéma et proposer les films et séries à (re)voir pour être à jour
avant la sortie. Exemples : *Avengers: Doomsday* et *Dune: Part Three*, annoncés pour le 18 décembre 2026
aux États-Unis. La date belge est à lire dans TMDB (région BE).

### Principe

Une nouvelle vue **« Au cinéma bientôt »** : pour chaque sortie qui intéresse la famille, un compte à
rebours (J-27) et la liste des titres à voir avant, avec leur état :

- ✅ vu (historique Jellyfin) ;
- ▶ dans la bibliothèque, à voir (Radarr, Sonarr, Jellyfin) ;
- ➕ absent : bouton « Demander » (ajout dans Radarr ou demande Seerr).

Un bouton **« Programmer le rattrapage »** place les titres manquants dans les créneaux libres avant la
sortie, en respectant la durée, le public et l'âge. Par exemple, pour Dune, deux films d'environ 2 h 30 :
la grande première du jeudi à 21 h et la soirée ciné du samedi.

Un événement **« 🎬 Sortie : … »** est ajouté au calendrier, avec la date et un rappel pour réserver les
places.

### Sources de données

- **TMDB** (clé API gratuite, à saisir dans Réglages → Connexions, comme les autres) :
  - `GET /movie/upcoming` ou `/discover/movie` avec `region=BE` et le type de sortie 2 ou 3 (salles) pour la
    liste. Attention : « upcoming » renvoie parfois des films déjà sortis ou des ressorties, il faut filtrer
    par date.
  - `release_dates` d'un film pour la date belge.
  - `belongs_to_collection`, puis `/collection/{id}`, pour la saga.
- **Radarr et Sonarr** : déjà utilisés pour « À venir », mais seulement pour les films suivis. TMDB couvre
  aussi les films non suivis.
- **Jellyfin** : historique « déjà vu » et lecture.

### Les titres à voir avant : trois niveaux

1. **Automatique, même saga** : les films précédents de la collection TMDB (*Dune: Part Three* → *Dune*
   et *Dune: Part Two*).
2. **Liste choisie par l'administrateur** : un écran dans Réglages (ou un fichier `prepa.json`) pour les
   univers sans collection claire. Pour Marvel, par exemple, on choisit les films qui comptent avant
   *Avengers: Doomsday*. L'app ne devine pas un « ordre officiel ».
3. **Séries** : pour une nouvelle saison, proposer de revoir la précédente (Sonarr, et « À suivre » de
   Jellyfin).

### Règles de l'interface

- Seules les sorties marquées **« J'irai le voir »** génèrent un plan de rattrapage. Sinon, l'écran serait
  noyé de blockbusters.
- On ne voit que ce qui manque : un titre déjà vu est coché, pas reproposé.
- Option **« Résumé rapide »** : un lien vers le résumé du film précédent, pour les titres que personne n'a
  envie de revoir (à définir).
- Avec le swipe : une rangée « Pour se mettre à jour ».

### À trancher

- [ ] Quels films et séries suivre ? Liste de départ : *Avengers: Doomsday*, *Dune: Part Three*.
- [ ] Qui décide « J'irai le voir » : chaque compte, ou l'administrateur seul ?
- [ ] Rattrapage placé automatiquement dans le planning, ou seulement des suggestions à valider ?
- [ ] Films absents : ajout automatique dans Radarr, ou simple demande Seerr ?
