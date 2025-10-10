import requests
from bs4 import BeautifulSoup
import unicodedata
import string
import time

BASE_URL = "https://dico-petitbac.com/film/film-"
OUTPUT_SQL_FILE = "insert_films.sql"
CATEGORIE_ID = 7  # catégorie films

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9",
}


def normalize_text(text: str) -> str:
    """Normalise le texte (apostrophes, espaces)"""
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("'", "'").strip()
    text = " ".join(text.split())
    return text


def slugify(text: str) -> str:
    """Supprime les accents, met en minuscules et retire les apostrophes et espaces pour mot_normalized."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = text.replace("'", "").replace(" ", "")
    return text.strip()


def scrape_films():
    all_films = set()

    for letter in string.ascii_lowercase:
        url = f"{BASE_URL}{letter}/"
        print(f"Scraping {url} ...")

        try:
            response = requests.get(url, headers=HEADERS, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")

            # Chaque film est dans un <li> (comme pour les animaux)
            li_elements = soup.find_all("li")
            count = 0

            for li in li_elements:
                textes = [normalize_text(t) for t in li.stripped_strings]
                for texte in textes:
                    if not texte or len(texte) <= 1:
                        continue
                    all_films.add(texte)
                    count += 1

            print(f"→ {count} films trouvés pour la lettre {letter.upper()}")
            time.sleep(1.2)

        except requests.exceptions.RequestException as e:
            print(f"Erreur lors du scraping de {url}: {e}")
            continue

    # Tri alphabétique
    all_sorted = sorted(all_films)
    print(f"\n✅ Total films uniques : {len(all_sorted)}")

    # Génération SQL
    with open(OUTPUT_SQL_FILE, "w", encoding="utf-8") as f:
        f.write("INSERT INTO mots (mot, mot_normalized, categorie_id) VALUES\n")

        sql_lines = []
        for mot in all_sorted:
            mot_sql = mot.replace("'", "''")  # échappe les apostrophes SQL
            mot_normalized = slugify(mot)
            sql_lines.append(f"    ('{mot_sql}', '{mot_normalized}', {CATEGORIE_ID})")

        f.write(",\n".join(sql_lines))
        f.write("\nON CONFLICT (mot_normalized, categorie_id) DO NOTHING;\n")

    print(f"✅ Fichier SQL '{OUTPUT_SQL_FILE}' généré avec succès !")
    print(f"🎬 Premiers films : {list(all_sorted)[:5]}")


if __name__ == "__main__":
    scrape_films()
