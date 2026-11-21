"""Bibliothèque fictive utilisée tant que Radarr et Sonarr ne sont pas branchés.

Elle permet de découvrir l'interface avant de saisir ses clés API.
"""

from __future__ import annotations

from datetime import date, timedelta


def _m(i, title, year, runtime, genres, cert, played=None):
    return {
        "uid": f"demo-film-{i}",
        "source": "demo",
        "kind": "film",
        "title": title,
        "year": year,
        "runtime": runtime,
        "genres": genres,
        "cert": cert,
        "overview": "",
        "poster": None,
        "tmdb": f"demo{i}",
        "played": played is not None,
        "last_played": played,
    }


def _s(i, title, year, runtime, genres, cert, next_up=None, played=False):
    return {
        "uid": f"demo-serie-{i}",
        "source": "demo",
        "kind": "serie",
        "title": title,
        "year": year,
        "runtime": runtime,
        "genres": genres,
        "cert": cert,
        "overview": "",
        "poster": None,
        "tvdb": f"demo{i}",
        "episodes_available": 60,
        "played": played,
        "last_played": None,
        "next_up": next_up,
    }


def library() -> list[dict]:
    long_ago = (date.today() - timedelta(days=1500)).isoformat()
    recent = (date.today() - timedelta(days=40)).isoformat()
    return [
        _m(1, "Le Roi Lion", 1994, 88, ["Animation", "Family", "Drama"], "G", long_ago),
        _m(2, "Mon voisin Totoro", 1988, 86, ["Animation", "Family", "Fantasy"], "G"),
        _m(3, "Paddington 2", 2017, 103, ["Comedy", "Family", "Adventure"], "PG"),
        _m(4, "Vice-Versa", 2015, 95, ["Animation", "Family", "Comedy"], "PG", recent),
        _m(5, "Ernest et Célestine", 2012, 80, ["Animation", "Family"], "PG"),
        _m(6, "Le Petit Prince", 2015, 108, ["Animation", "Family", "Fantasy"], "PG"),
        _m(7, "Beethoven", 1992, 87, ["Comedy", "Family"], "PG"),
        _m(8, "Wallace et Gromit : Le Mystère du lapin-garou", 2005, 85, ["Animation", "Family", "Comedy"], "G"),
        _m(9, "Le Château dans le ciel", 1986, 124, ["Animation", "Family", "Adventure"], "PG"),
        _m(10, "Inception", 2010, 148, ["Action", "Science Fiction", "Thriller"], "PG-13", long_ago),
        _m(11, "Dune : Deuxième partie", 2024, 166, ["Science Fiction", "Adventure"], "PG-13"),
        _m(12, "Le Fabuleux Destin d'Amélie Poulain", 2001, 122, ["Comedy", "Romance"], "R", long_ago),
        _m(13, "Intouchables", 2011, 112, ["Comedy", "Drama"], "R"),
        _m(14, "Toto le héros", 1991, 91, ["Comedy", "Drama"], "PG-13"),
        _m(15, "Parasite", 2019, 132, ["Thriller", "Drama", "Comedy"], "R"),
        _m(16, "La La Land", 2016, 128, ["Romance", "Music", "Drama"], "PG-13", recent),
        _m(17, "Le Grand Bain", 2018, 122, ["Comedy", "Drama"], "R"),
        _m(18, "Retour vers le futur", 1985, 116, ["Adventure", "Comedy", "Science Fiction"], "PG", long_ago),
        _m(19, "Le Sel de la Terre", 2014, 110, ["Documentary"], "PG-13"),
        _m(20, "Microcosmos", 1996, 80, ["Documentary", "Family"], "G"),
        _s(1, "Bluey", 2018, 8, ["Animation", "Family", "Children"], "TV-Y",
           {"season": 2, "episode": 14, "name": "Le jeu de la crêpe"}),
        _s(2, "Peppa Pig", 2004, 10, ["Animation", "Children"], "TV-Y"),
        _s(3, "Il était une fois... la Vie", 1987, 25, ["Animation", "Children", "Documentary"], "TV-Y7",
           {"season": 1, "episode": 6, "name": "Le cœur"}),
        _s(4, "Ted Lasso", 2020, 35, ["Comedy", "Drama"], "TV-MA",
           {"season": 2, "episode": 3, "name": "Doc"}),
        _s(5, "Severance", 2022, 50, ["Drama", "Mystery", "Science Fiction"], "TV-MA",
           {"season": 1, "episode": 4, "name": "Le Vous caché"}),
        _s(6, "Kaamelott", 2005, 4, ["Comedy"], "TV-14"),
        _s(7, "The Bear", 2022, 30, ["Comedy", "Drama"], "TV-MA"),
        _s(8, "Planète Terre II", 2016, 50, ["Documentary"], "TV-G",
           {"season": 1, "episode": 2, "name": "Montagnes"}),
        _s(9, "Our Planet", 2019, 50, ["Documentary"], "TV-PG"),
    ]


def upcoming(start: date) -> list[dict]:
    d = lambda n: (start + timedelta(days=n)).isoformat()  # noqa: E731
    return [
        {"date": d(1), "kind": "serie", "title": "Bluey", "series_uid": "demo-serie-1",
         "detail": "S03E12 · Le marché", "poster": None, "available": True},
        {"date": d(3), "kind": "serie", "title": "Severance", "series_uid": "demo-serie-5",
         "detail": "S02E01 · Bonjour, Mme Cobel", "poster": None, "available": False},
        {"date": d(4), "kind": "film", "title": "Le Robot sauvage", "detail": "Sortie numérique",
         "poster": None, "available": False},
        {"date": d(9), "kind": "serie", "title": "The Bear", "series_uid": "demo-serie-7",
         "detail": "S04E01", "poster": None, "available": False},
    ]
