import requests
from bs4 import BeautifulSoup
import string
import time
import unicodedata

BASE_URL = "https://dico-petitbac.com/animaux/animal-"
OUTPUT_SQL_FILE = "insert_animaux.sql"
CATEGORIE_ID = 4  # catégorie animaux

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
    """Convertit en minuscules sans accents pour la recherche"""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ASCII", "ignore").decode("utf-8")
    text = text.lower()
    return text


def scrape_animaux():
    all_animaux = set()  # Utilise un set pour éviter les doublons

    for letter in string.ascii_lowercase:
        url = f"{BASE_URL}{letter}/"
        print(f"Scraping {url} ...")

        try:
            response = requests.get(url, headers=HEADERS, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")

            # Trouve TOUS les <li> de la page (même imbriqués)
            li_elements = soup.find_all("li")
            
            count = 0
            for li in li_elements:
                # Récupère uniquement le texte direct du <li>, sans ses enfants
                textes = [t.strip() for t in li.find_all(string=True, recursive=False)]
                
                for texte in textes:
                    # Filtre les textes vides et les espaces
                    if not texte or len(texte.strip()) == 0:
                        continue
                    
                    mot = normalize_text(texte)
                    
                    # Filtre les lignes vides ou trop courtes
                    if mot and len(mot) > 1:
                        all_animaux.add(mot)
                        count += 1
            
            print(f"→ {count} mots trouvés pour la lettre {letter.upper()}")
            time.sleep(1.2)

        except requests.exceptions.RequestException as e:
            print(f"Erreur lors du scraping de {url}: {e}")
            continue

    # Tri alphabétique
    all_animaux_sorted = sorted(all_animaux)
    print(f"\n✅ Total mots uniques : {len(all_animaux_sorted)}")

    # Génération SQL
    with open(OUTPUT_SQL_FILE, "w", encoding="utf-8") as f:
        f.write("INSERT INTO mots (mot, mot_normalized, categorie_id) VALUES\n")

        sql_lines = []
        for mot in all_animaux_sorted:
            mot_sql = mot.replace("'", "''")  # Échappe les apostrophes SQL
            mot_normalized = slugify(mot)
            sql_lines.append(f"    ('{mot_sql}', '{mot_normalized}', {CATEGORIE_ID})")

        f.write(",\n".join(sql_lines))
        # ✅ ON CONFLICT doit être AVANT le point-virgule
        f.write("\nON CONFLICT (mot_normalized, categorie_id) DO NOTHING;\n")

    print(f"✅ Fichier SQL '{OUTPUT_SQL_FILE}' généré avec succès !")
    print(f"📊 Premiers mots : {list(all_animaux_sorted)[:5]}")


if __name__ == "__main__":
    scrape_animaux()