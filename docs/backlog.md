# Calendarr: backlog

The goal is spouse approval. On a Wednesday afternoon, she opens the app on the iPad, the phone or the
kitchen screen, understands in two seconds what's on, and starts it.

Decided on 21 November 2026: the app must work on the PC, the iPhone, the iPad and the kitchen smart
display; the family watches with Infuse on Apple TV; ages are shown simply ("Tous publics", "Dès 12
ans", i.e. "All ages", "12 and up").

## Done

- [x] "Ce soir" (Tonight) home page: the next program in large, with "▶ Regarder" (Watch), "Autre idée"
  (Another idea) and "Pas ce soir" (Not tonight), then the next three.
- [x] "▶ Regarder" on every card. Depending on the setting, it opens Jellyfin, opens Infuse on the device
  (`infuse://`), or tells you where to find the title and episode in Infuse on Apple TV.
- [x] Installable app (PWA), full screen on iOS, with an option to keep the screen on.
- [x] French everywhere in the app: recommended age, "Pas cette fois", a simpler banner for the family.
- [x] On phones, week actions are in a ⋯ menu and cards are compact; on large screens, week cards use the
  full width.
- [x] Kitchen screen (`/mur`): secret link, read only, clock, Tonight and what's next, auto refresh, any
  screen size.
- [x] One Jellyfin collection per week ("Calendarr · Semaine du 23 novembre") with what is left to watch.
  Past days drop out and the previous week's collection is deleted on Monday.
- [x] Accounts and roles (administrator, family), connections entered in the app.
- [x] Security review (v0.1.0): non-root container, API key cleared when a service address changes, login
  rate limits per device and per account, secret tokens hidden from logs, security headers, updated
  dependencies.
- [x] Releases on GitHub: `latest` follows the latest stable version, `edge` the main branch.

## P1: surprise and feedback

- [x] Swipeable "Surprends-moi" (Surprise me), also usable with buttons or the keyboard, with undo. Right:
  the title goes into the next suitable slot. Left: never suggested again. Up: marked as watched (a movie
  is also marked in Jellyfin). Down: it comes back in two weeks.
- [x] Match for two: each parent swipes on their own account; when both say yes, the movie is scheduled
  and added to "Vos matchs" (Your matches).
- [x] Memory of choices, used by the planner: a "no" rules a title out, a "yes" favors it.
- [x] One Jellyfin user per audience (parents, kids, family): each audience has its own watch history and
  series progress.
- [x] "Vu" (Watched) on week and Tonight cards. For today or a past day, "On l'a vu" (We watched it) marks
  the movie or episodes as watched in Jellyfin for the right user. For an upcoming program, "Déjà vu"
  (Already seen) replaces a movie, or moves a series on to the next episodes.
- [x] Feedback from 21 November: the week opens on today with past days folded, one visible action per
  card (the rest in "…"), full-bleed poster in the swipe deck with the text on a solid dark background,
  "À venir" (Coming up) starts today ("Prêt à regarder" / "Sort le 24 nov."), "Garder l'écran allumé"
  (Keep the screen on) at the top of Tonight, bigger swipe buttons.
- [x] "Autre idée" opens a list of suggestions for the slot (or "Au hasard", at random); marking a movie as
  watched opens the same list to pick something else. Series episodes and upcoming releases are cached
  for 10 minutes, so the button responds faster.

## Brief of 21 November: "nothing is scheduled until the family chooses it"

- [x] Step 1: field-test fixes (see P1 above).
- [x] Step 2: series states and idea / confirmed. "On la regarde" / "Plus tard" (reminder in 1, 3, 6
  months or on a date) / "Pas pour nous", plus "À classer" for new Sonarr downloads (administrator only).
  Prefilled from Jellyfin on first launch. Stored in `/config/watchstate.json`. The planner only
  schedules "On la regarde" series for their audience; proposals are "ideas" until confirmed; the iCal
  feed and the Jellyfin collection only contain confirmed programs.
- [ ] Step 3: compose the week (deck building).
- [ ] Step 4: first-run walkthrough.
- [ ] Step 5: the Sunday card.

## P2: Jellyfin and Infuse

- [ ] Playback link in the iCloud calendar event.
- [ ] Check on the Apple TV that the weekly collection shows up in Infuse.
- [ ] Test `infuse://` links (movies, series, episodes) on iPhone and iPad.
- [ ] Serve posters from Jellyfin on the NAS, with a cache, instead of from the Internet (TMDB).

## Security, later

- [ ] Protect first-account creation, for example with a code printed in the container logs.
- [ ] Pin GitHub Actions by commit SHA rather than by version tag.
- [ ] A strict Content Security Policy. This first requires moving JavaScript out of HTML attributes.

## P3: later

- [ ] Seerr: suggest titles that aren't in the library and request them in one tap.
- [ ] Audio language: leave out titles without a French audio track for the kids.
- [ ] Notification 15 minutes before (ntfy or web push), in addition to the calendar alarm.
- [ ] Family statistics: planned screen time, screen-free evenings kept.

## Idea: movie releases and catching up (21 November 2026)

Follow upcoming theatrical releases and suggest what to watch or rewatch beforehand, so the family is up
to date. *Avengers: Doomsday* and *Dune: Part Three*, for example, are announced for 18 December 2026 in
the US; the Belgian date is in TMDB (region BE).

### How it would work

A new "Au cinéma bientôt" (In theaters soon) view shows, for each release the family cares about, a
countdown (D-27) and the titles to watch first. Each title is either already watched (according to
Jellyfin), in the library and still to watch, or missing, in which case a "Demander" (Request) button adds
it to Radarr or sends a Seerr request.

"Programmer le rattrapage" (Schedule the catch-up) puts the missing titles into the free slots before the
release, respecting length, audience and age. For Dune, that would be two movies of about 2 h 30: the
Thursday 9 pm "grande première" and the Saturday movie night.

The release itself is added to the calendar ("🎬 Sortie : …"), with a reminder to book tickets.

### Data sources

TMDB needs an API key (free), entered in Settings → Connections like the others:

- `GET /movie/upcoming` or `/discover/movie` with `region=BE` and release type 2 or 3 (theatrical) for the
  list. "upcoming" sometimes returns movies already out or re-releases, so filter by date;
- a movie's `release_dates` for the Belgian date;
- `belongs_to_collection`, then `/collection/{id}`, for the franchise.

Radarr and Sonarr already power "À venir", but they only know the movies you follow; TMDB covers the
others too. Jellyfin provides the watch history and playback.

### Titles to watch first

1. Earlier movies of the same franchise, found automatically in the TMDB collection (*Dune: Part Three*
   brings *Dune* and *Dune: Part Two*).
2. A list chosen by the administrator, in a Settings screen or a `prepa.json` file, for universes without
   a clear collection. For Marvel, you pick the movies that matter before *Avengers: Doomsday* yourself:
   the app doesn't guess an "official order".
3. For a new season of a series, rewatch the previous one (Sonarr, and "Next Up" in Jellyfin).

### Interface rules

- Only releases marked "J'irai le voir" (I'll go see it) get a catch-up plan; otherwise the screen would
  drown in blockbusters.
- A title already watched is ticked and not suggested again.
- For a movie nobody wants to rewatch, a "Résumé rapide" (Quick recap) could link to a summary (to be
  defined).
- In the swipe deck, a "Pour se mettre à jour" (To catch up) row.

### To decide

- [ ] Which movies and series to follow? To start: *Avengers: Doomsday* and *Dune: Part Three*.
- [ ] Who decides "J'irai le voir": each account, or only the administrator?
- [ ] Is the catch-up placed in the schedule automatically, or only suggested for approval?
- [ ] Are missing movies added straight to Radarr, or requested through Seerr?
