# Calendarr : backlog

Le but, c'est que l'épouse approuve. Le mercredi après-midi, elle ouvre l'app sur l'iPad, le téléphone ou
l'écran de la cuisine, comprend en deux secondes ce qu'on regarde, et le lance.

Ce qui est décidé (21 novembre 2026) : l'app doit marcher sur le PC, l'iPhone, l'iPad et l'écran
d'assistant de la cuisine ; la famille regarde avec Infuse sur l'Apple TV ; l'âge s'affiche simplement
(« Tous publics », « Dès 12 ans »).

## Fait

- [x] Page d'accueil « Ce soir » : le prochain programme en grand, avec « ▶ Regarder », « Autre idée » et
  « Pas ce soir », puis les trois suivants.
- [x] « ▶ Regarder » sur chaque carte. Selon le réglage, il ouvre Jellyfin, ouvre Infuse sur l'appareil
  (`infuse://`), ou indique où trouver le titre et l'épisode dans Infuse sur l'Apple TV.
- [x] App installable sur l'écran d'accueil (PWA), en plein écran sur iOS, avec l'option de garder l'écran
  allumé.
- [x] Textes en français partout : âge conseillé, « Pas cette fois », bandeau simplifié pour la famille.
- [x] Sur téléphone, les actions de la semaine sont dans un menu ⋯ et les cartes sont compactes ; sur grand
  écran, les cartes de la semaine prennent toute la largeur.
- [x] Écran de cuisine (`/mur`) : lien secret, lecture seule, horloge, « Ce soir » et la suite, mise à jour
  automatique, toutes tailles d'écran.
- [x] Une collection Jellyfin par semaine (« Calendarr · Semaine du 23 novembre ») avec ce qui reste à voir.
  Les jours passés en sortent et l'ancienne semaine est supprimée le lundi.
- [x] Comptes et rôles (administrateur, famille), connexions saisies dans l'app.
- [x] Relecture de sécurité (v0.1.0) : conteneur sans root, clé redemandée si l'adresse d'un service
  change, limite d'essais par appareil et par compte, jetons masqués dans les journaux, en-têtes de
  sécurité, dépendances à jour.
- [x] Versions publiées sur GitHub : `latest` suit la dernière version stable, `edge` la branche main.

## P1 : surprise et retour d'information

- [x] « Surprends-moi » en swipe (v0.2.0), aussi utilisable avec des boutons ou le clavier, avec
  annulation du dernier choix. Vers la droite, le titre va dans le prochain créneau compatible ; vers la
  gauche, il n'est plus jamais proposé ; vers le haut, il est marqué vu (un film l'est aussi dans
  Jellyfin) ; vers le bas, il revient dans deux semaines.
- [x] Match à deux : chacun swipe sur son compte, et si deux personnes disent oui, le film est programmé
  et rejoint « Vos matchs ».
- [x] Mémoire des choix, lue par le planificateur : un « non » écarte le titre, un « oui » le favorise.
- [ ] Un utilisateur Jellyfin par public (parents, enfants), pour que l'historique « déjà vu » des
  enfants ne se mélange pas à celui des parents.
- [ ] Bouton « Déjà vu » aussi sur les cartes de la semaine et de « Ce soir ».

## P2 : Jellyfin et Infuse

- [ ] Lien de lecture dans l'événement du calendrier iCloud.
- [ ] Vérifier sur l'Apple TV que la collection de la semaine apparaît bien dans Infuse.
- [ ] Tester les liens `infuse://` (films, séries, épisodes) sur l'iPhone et l'iPad.
- [ ] Servir les jaquettes depuis Jellyfin, sur le NAS, avec un cache, plutôt que depuis Internet (TMDB).

## Sécurité, plus tard

- [ ] Protéger la création du premier compte, par exemple avec un code affiché dans les journaux du
  conteneur.
- [ ] Épingler les actions GitHub par empreinte (SHA) plutôt que par numéro de version.
- [ ] Une politique de sécurité du contenu (CSP) stricte. Il faudra d'abord sortir le JavaScript des
  attributs HTML.

## P3 : plus tard

- [ ] Seerr : proposer des titres absents de la bibliothèque et les demander d'un geste.
- [ ] Langue audio : écarter les titres sans piste française pour les enfants.
- [ ] Notification 15 minutes avant (ntfy ou notification web), en plus de l'alarme du calendrier.
- [ ] Statistiques de la famille : temps d'écran prévu, soirées sans écran tenues.

## Idée : sorties cinéma et rattrapage (21 novembre 2026)

Suivre les sorties au cinéma et proposer ce qu'il faut voir ou revoir avant, pour arriver à jour.
*Avengers: Doomsday* et *Dune: Part Three* sont par exemple annoncés pour le 18 décembre 2026 aux
États-Unis ; la date belge se lit dans TMDB (région BE).

### Principe

Une vue « Au cinéma bientôt » montre, pour chaque sortie qui intéresse la famille, un compte à rebours
(J-27) et les titres à voir avant. Chaque titre est soit déjà vu (d'après Jellyfin), soit dans la
bibliothèque et à voir, soit absent, avec alors un bouton « Demander » (ajout dans Radarr ou demande
Seerr).

« Programmer le rattrapage » place les titres manquants dans les créneaux libres avant la sortie, en
respectant la durée, le public et l'âge. Pour Dune, ça donnerait deux films d'environ 2 h 30 : la grande
première du jeudi à 21 h et la soirée ciné du samedi.

La sortie elle-même s'ajoute au calendrier (« 🎬 Sortie : … »), avec un rappel pour réserver les places.

### Sources de données

TMDB demande une clé API, gratuite, à saisir dans Réglages → Connexions comme les autres :

- `GET /movie/upcoming` ou `/discover/movie` avec `region=BE` et le type de sortie 2 ou 3 (salles) pour la
  liste. « upcoming » renvoie parfois des films déjà sortis ou des ressorties : il faut filtrer par date ;
- `release_dates` d'un film pour la date belge ;
- `belongs_to_collection`, puis `/collection/{id}`, pour la saga.

Radarr et Sonarr servent déjà pour « À venir », mais ne connaissent que les films suivis ; TMDB couvre
aussi les autres. Jellyfin donne l'historique « déjà vu » et permet de lancer la lecture.

### Les titres à voir avant

1. Les films précédents de la même saga, trouvés automatiquement dans la collection TMDB (*Dune: Part
   Three* amène *Dune* et *Dune: Part Two*).
2. Une liste choisie par l'administrateur, dans un écran de Réglages ou un fichier `prepa.json`, pour les
   univers sans collection claire. Pour Marvel, on choisit soi-même les films qui comptent avant
   *Avengers: Doomsday* : l'app ne devine pas d'« ordre officiel ».
3. Pour une nouvelle saison de série, revoir la précédente (Sonarr, et « À suivre » dans Jellyfin).

### Règles de l'interface

- Seules les sorties marquées « J'irai le voir » donnent un plan de rattrapage, sinon l'écran serait
  noyé sous les blockbusters.
- Un titre déjà vu est coché et n'est pas reproposé.
- Pour un film que personne n'a envie de revoir, un « Résumé rapide » pourrait renvoyer vers un résumé
  (reste à définir).
- Dans le swipe, une rangée « Pour se mettre à jour ».

### À trancher

- [ ] Quels films et séries suivre ? Pour commencer : *Avengers: Doomsday* et *Dune: Part Three*.
- [ ] Qui décide « J'irai le voir » : chaque compte, ou l'administrateur seul ?
- [ ] Le rattrapage se place-t-il tout seul dans le planning, ou reste-t-il une suggestion à valider ?
- [ ] Les films absents s'ajoutent-ils directement dans Radarr, ou passent-ils par une demande Seerr ?
