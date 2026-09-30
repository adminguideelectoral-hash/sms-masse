# SMS Bridge

Petite interface web locale pour diffuser un même SMS à une liste de numéros
depuis la vraie SIM du téléphone Android, via `kdeconnect-cli`.

Le navigateur ne peut pas lancer de processus : un petit pont HTTP Python
(bibliothèque standard uniquement) sert l'interface et exécute `kdeconnect-cli`
côté machine. Il n'écoute que sur `127.0.0.1`.

## Prérequis

1. Avoir suivi `../GUIDE.md` jusqu'à l'appairage (téléphone appairé et joignable).
2. `kdeconnect-cli` dans le `PATH`.
3. Un appareil appairé visible :

   ```bash
   kdeconnect-cli -l 2>/dev/null | grep 'paired and reachable'
   ```

## Lancement

```bash
python3 /home/yanarion/Projet/phone_pq/app/server.py
```

Puis ouvrir <http://127.0.0.1:8765/> dans un navigateur.
`Ctrl+C` dans le terminal arrête le serveur.

## Utilisation

1. **Appareil** : choisir le téléphone dans la liste (rafraîchir si besoin).
2. **Message** :
   - onglet *Texte* : saisir le message, ou
   - onglet *Fichier* : charger un `.txt`.
   Le compteur affiche la longueur et le nombre de SMS par destinataire
   (160 caractères GSM-7, 70 sinon).
3. **Destinataires** : indiquer l'indicatif par défaut (`+1` par défaut), puis
   charger un CSV ou coller les numéros (un par ligne). Le parseur prend la
   première cellule qui ressemble à un numéro, ignore la première ligne si c'est
   un en-tête, applique l'indicatif, dédoublonne et signale les lignes non
   reconnues.
4. Vérifier l'aperçu et l'estimation `N × segments = SMS facturés`.
5. Laisser **Simulation** cochée pour un test à blanc, puis décocher et
   **Lancer l'envoi**. Une confirmation est demandée pour un envoi réel.
6. La progression et le résultat par numéro s'affichent en direct ; **Arrêter**
   interrompt la file entre deux numéros.

### Format CSV accepté

```csv
number,name
5145551234,Alice
(438) 555-9999,Bob
+33612345678,Chloé
```

Les espaces, points, tirets et parenthèses sont retirés.

### Indicatif par défaut

Le champ **Indicatif par défaut** vaut `+1` au démarrage et s'applique à chaque
numéro qui ne commence pas par `+` :

| Saisi | Indicatif | Résultat |
|---|---|---|
| `5145551234` | `+1` | `+15145551234` |
| `15145551234` | `+1` | `+15145551234` (indicatif déjà là) |
| `(438) 555-9999` | `+1` | `+14385559999` |
| `+33612345678` | `+1` | `+33612345678` (conservé tel quel) |
| `5145551234` | *(vide)* | `5145551234` |

Modifie le champ pour viser un autre pays (ex. `+33`). Le dédoublonnage est
appliqué **après** normalisation : `5145551234` et `15145551234` comptent pour un
seul destinataire.

Attention : le préfixe national n'est pas retiré. Un numéro français saisi
`0612345678` avec l'indicatif `+33` devient `+330612345678` ; écris
`612345678` ou `+33612345678`.

## API

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/` | Interface |
| `GET` | `/api/devices` | Appareils détectés (id, nom, appairé, joignable) |
| `POST` | `/api/send` | Lance un envoi, renvoie un `job_id` |
| `GET` | `/api/job/<id>` | Progression et résultats du job |
| `POST` | `/api/cancel/<id>` | Demande l'arrêt du job |

`POST /api/send` — corps JSON :

```json
{
  "device_id": "e7c9f97f9a54497db1c0466e07b21c18",
  "message": "Rappel réunion 15h",
  "numbers": ["5145551234", "4385559999"],
  "default_prefix": "+1",
  "delay": 1,
  "dry_run": true
}
```

## Garde-fous

- Serveur lié à `127.0.0.1` uniquement.
- `device_id` vérifié contre la liste réelle des appareils.
- Numéros validés (`^\+?\d{6,15}$`) et dédoublonnés côté serveur aussi, après
  application de l'indicatif par défaut (`+1` si absent).
- Appels `subprocess` en forme de liste (jamais de shell).
- Limites : message ≤ 2000 caractères, ≤ 1000 destinataires, envoi ≤ 30 s ;
  délai borné à 60 s.
- Aucun SMS n'est envoyé tant que **Simulation** est cochée.

## Fichiers

| Fichier | Rôle |
|---|---|
| `server.py` | Pont HTTP + validation + exécution de `kdeconnect-cli` |
| `static/index.html` | Structure de l'interface |
| `static/style.css` | Style (clair/sombre automatique) |
| `static/app.js` | Parsing CSV, comptage des segments, progression |
