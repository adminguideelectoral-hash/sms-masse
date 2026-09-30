# Guide d'installation — KDE Connect (broadcast SMS depuis Ubuntu)

Setup validé : **KDE Connect (build F-Droid) sur Android** + **paquet `kdeconnect` sur Ubuntu**.

Ce setup envoie des SMS **depuis ton vrai numéro de téléphone** (SIM dans le téléphone Android),
et permet de répondre individuellement à chaque destinataire depuis le PC.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Installation sur Ubuntu](#2-installation-sur-ubuntu)
3. [Installation sur Android via F-Droid](#3-installation-sur-android-via-f-droid)
4. [Permissions Android](#4-permissions-android)
5. [Appairage (via interface graphique)](#5-appairage-via-interface-graphique)
6. [Trouver le Device ID](#6-trouver-le-device-id)
7. [Test d'envoi unitaire](#7-test-denvoi-unitaire)
8. [Broadcast depuis un CSV](#8-broadcast-depuis-un-csv)
9. [Intégration dans un script](#9-intégration-dans-un-script)
10. [Limites et coûts](#10-limites-et-coûts)
11. [Dépannage](#11-dépannage)
12. [Interface web (optionnelle)](#12-interface-web-optionnelle)

---

## 1. Vue d'ensemble

```
┌─────────────────┐   Wi-Fi (LAN)    ┌──────────────────────┐
│  Téléphone      │◄────────────────►│  Ubuntu              │
│  Android        │  TLS + appairage │                      │
│                  │                  │  kdeconnectd         │
│  SIM = ton vrai │                  │  kdeconnect-cli      │
│  numéro         │                  │  kdeconnect-sms      │
│                  │                  │        ▲             │
│  Base F-Droid   │                  │        │             │
│  (SMS inclus)   │                  │  script CSV ─────────┘
└─────────────────┘
```

Le SMS est envoyé par la pile telephony **du téléphone**, pas par l'ordinateur. C'est ce qui
distingue ce setup d'un soft phone (voir §10).

**Composants installés par le paquet `kdeconnect` :**

| Binaire | Rôle |
|---|---|
| `kdeconnectd` | Daemon, activé via D-Bus et autostart |
| `kdeconnect-cli` | Envoi SMS, appairage, diagnostic |
| `kdeconnect-sms` | Boîte de réception graphique, un fil par numéro |
| `kdeconnect-indicator` | Icône tray |
| `kdeconnect-app` | Fenêtre de configuration |

---

## 2. Installation sur Ubuntu

### 2.1 Installer le paquet

```bash
sudo apt update
sudo apt install kdeconnect
```

Le paquet `kdeconnect` (section *universe*) fournit **tous** les binaires listés ci-dessus.
Il n'existe pas de paquet `kdeconnect-cli` séparé.

### 2.3 Vérifier l'installation

```bash
kdeconnect-cli --version
# attendu : kdeconnect-cli 26.x.x  (ou 21.12.3+ sur les LTS plus anciens)

kdeconnect-cli --list-backends
# attendu : LAN | lan | enabled
```

Si `lan` est `disabled` :

```bash
kdeconnect-cli --enable-backend lan
```

---

## 3. Installation sur Android via F-Droid

### 3.1 Pourquoi F-Droid et pas Google Play

Google a **retiré le support SMS** de la version Play Store de KDE Connect en 2019, après une
modification de sa politique sur les permissions SMS/MMS. Le build Play peut se connecter mais
**ne reçoit ni n'envoie aucun SMS**.

La build F-Droid est compilée depuis les sources officielles du projet KDE Connect, avec le
plugin SMS inclus. Ce n'est pas un APK modifié ni un fork.

### 3.2 Installer F-Droid

1. Sur le téléphone, ouvrir Chrome et aller sur :

   ```
   https://f-droid.org/F-Droid.apk
   ```

   (ou visiting `f-droid.org` puis **Download F-Droid** — même fichier)

2. Android affichera un avertissement du type *« Ce fichier peut endommager votre appareil »*.
   C'est **normal** : Android bloque par défaut les APK installés par le navigateur.
   Appuyer sur **Paramètres** dans ce dialogue → activer **Autoriser depuis cette source** → retour.

3. Appuyer sur **Installer**.

4. Ouvrir F-Droid et laisser l'index initial se synchroniser (1 à 2 minutes).

> 🔒 **Télécharger uniquement depuis le domaine `f-droid.org`.** De nombreux sites miroirs
> repackagent ces APK. Le domaine est la seule garantie de sécurité.

### 3.3 Installer KDE Connect

Dans F-Droid : rechercher **"KDE Connect"** → **Installer**.

Version attendue : **1.35.13** (légèrement en retard sur le Play Store — c'est le compromis
pour disposer du SMS). Package id : `org.kde.kdeconnect_tp`.

### 3.4 Alternative sans installer F-Droid

Pour installer uniquement l'APK KDE Connect, sans l'app F-Droid :

```
https://f-droid.org/packages/org.kde.kdeconnect_tp/
```

Taper **Download APK** en bas de page. Inconvénient : plus de notifications de mise à jour.

---

## 4. Permissions Android

C'est **l'étape la plus souvent ratée**. Sans elle, l'appairage fonctionne mais aucun SMS
n'arrive ni ne part.

### 4.1 Permissions standard

*Paramètres → Applications → KDE Connect → Permissions*

| Permission | Nécessaire pour |
|---|---|
| **SMS** (envoyer + voir) | Lire l'historique et envoyer depuis le PC |
| **Contacts** | Afficher les noms dans `kdeconnect-sms` |
| **Phone** | Fonctions téléphone (optionnel) |
| *Files and media* | Navigation fichiers (non requis ici) |

### 4.2 Accès aux notifications (écran séparé)

*Paramètres → Applications → Accès applications spéciales → **Accès aux notifications*** → activer **KDE Connect**

Cet écran n'est **pas** dans la liste normale des permissions. Sans lui, les notifications
de SMS n'apparaissent jamais sur le PC.

### 4.3 Activer le plugin SMS

Dans l'app KDE Connect : **⋮ → Plugins → SMS integration** → activer.

---

## 5. Appairage (via interface graphique)

L'appairage se fait **uniquement par l'interface graphique**, sans aucune commande CLI.

`kdeconnect-sms` n'a **pas d'appairage séparé** : il réutilise l'appairage unique KDE Connect.

### 5.1 Prérequis réseau

Ordinateur et téléphone doivent être sur le **même sous-réseau Wi-Fi**. La découverte utilise
des datagrammes UDP broadcast — un réseau invité ou une isolation AP casse la découverte.

Si les deux appareils ne se voient pas alors qu'ils sont sur le même Wi-Fi, utiliser
**⋮ → Add device by IP** sur le téléphone et saisir l'IP de l'ordinateur.

### 5.2 Sur le téléphone

1. Ouvrir l'app **KDE Connect**
2. Dans la liste des appareils, toucher **l'ordinateur** (il doit apparaître en quelques
   secondes s'il est sur le même réseau)
3. Appuyer sur **Pair / Appairer**
4. Un **code PIN** s'affiche — le noter

### 5.3 Sur l'ordinateur

Une notification de demande d'appairage apparaît dans la zone de notification
(ou via l'icône KDE Connect dans la barre système) :

1. Cliquer sur la notification
2. **Saisir le même code PIN** que celui affiché sur le téléphone
3. Confirmer → les deux écrans affichent la confirmation

### 5.4 Vérifier l'état

L'app KDE Connect sur le téléphone doit indiquer l'ordinateur comme **appairé** (icône
d'appairement valide). En complément, depuis le PC :

```bash
kdeconnect-cli -l
```

Sortie attendue (format réel de `kdeconnect-cli -l`) :

```
- Galaxy S25: 0c45bdca89454e80bdc47f303157b83a on 192.168.0.214 via LAN (reachable)
- Nothing Phone 3a: e7c9f97f9a54497db1c0466e07b21c18 on 192.168.0.43 via LAN (paired and reachable)
```

Il faut lire **`paired and reachable`**. Un simple `reachable` signifie appairé en attente
ou non appairé.

> 📌 **Le compteur `N devices found` va sur stderr**, pas sur stdout. Toujours filtrer avec
> `2>/dev/null` dans un script.

---

## 6. Trouver le Device ID

C'est la valeur dont la future liste d'envoi aura besoin.

### 6.1 Sortie brute

```bash
kdeconnect-cli -l
```

### 6.2 Extraire l'ID de l'appareil appairé (commande vérifiée)

```bash
kdeconnect-cli -l 2>/dev/null \
  | grep 'paired and reachable' \
  | sed 's/^- [^:]*: //' \
  | cut -d' ' -f1
```

Sortie testée sur cette machine :

```
e7c9f97f9a54497db1c0466e07b21c18
```

### 6.3 Nom du téléphone + ID appairé (1 seule ligne)

```bash
kdeconnect-cli -l 2>/dev/null \
  | grep 'paired and reachable' \
  | awk '{sub(/^- /,""); split($0, a, ":"); print a[1] "|" $2}'
```

⚠️ Cette variante **découpe sur chaque espace**, donc un nom contenant un espace est tronqué.
Sortie réelle obtenue ici :

```
Nothing Phone 3a|Phone
```

Pour un nom avec espaces, découper sur le `:` uniquement :

```bash
kdeconnect-cli -l 2>/dev/null \
  | grep 'paired and reachable' \
  | sed 's/^- //' \
  | awk -F': ' '{n=$1; id=$2; sub(/ .*/,"",id); print n "|" id}'
```

```
Nothing Phone 3a|e7c9f97f9a54497db1c0466e07b21c18
```

### 6.4 Stocker l'ID pour la session

```bash
export KC_DEVICE_ID="$(kdeconnect-cli -l 2>/dev/null \
  | grep 'paired and reachable' \
  | sed 's/^- [^:]*: //' \
  | cut -d' ' -f1)"
echo "Device ID : $KC_DEVICE_ID"
```

### 6.5 Si plusieurs téléphones sont appairés

Si la commande 6.2 renvoie plusieurs lignes, il faut choisir explicitement :

```bash
kdeconnect-cli -l 2>/dev/null | grep 'paired and reachable'
# choisir celui qui porte la bonne SIM, puis :
kdeconnect-cli -d e7c9f97f9a54497db1c0466e07b21c18 --send-sms "..." --destination "+33..."
```

On peut aussi cibler par nom plutôt que par ID :

```bash
kdeconnect-cli -n "Nothing Phone 3a" --send-sms "..." --destination "+33..."
```

> `--device` / `-d` attend un **ID**. `--name` / `-n` attend un **nom**.

---

## 7. Test d'envoi unitaire

**Envoyer d'abord à son propre numéro.** Cela évite de facturer et d'envoyer un vrai SMS à un tiers.

```bash
kdeconnect-cli -d "$KC_DEVICE_ID" \
  --send-sms "test CLI linux" \
  --destination "+33612345678"
```

Le message doit apparaître **dans les deux endroits** :

- l'app SMS native du téléphone
- `kdeconnect-sms` sur le PC

Si les deux sont là, le broadcast fonctionnera.

---

## 8. Broadcast depuis un CSV

### 8.1 Format du CSV attendu

Première ligne = en-tête (ignorée). Première colonne = numéro, format international E.164.

```csv
number,name
+33612345678,Alice
+33698765432,Bob
+33655555555,Chloé
+33644444444,David
+33612345678,Alice
```

> ⚠️ Noter la dernière ligne : doublon volontaire, supprimé automatiquement (§8.3).

### 8.2 Extraire les numéros

```bash
tail -n +2 contacts.csv \
  | tr -d ' \t\r' \
  | cut -d, -f1 \
  | grep -E '^\+?[0-9]{6,15}$'
```

`grep -E` sert de garde-fou : toute ligne mal formée est ignorée silencieusement. Pour les
afficher, inverser le filtre.

### 8.3 Dédupliquer en préservant l'ordre

```bash
tail -n +2 contacts.csv \
  | tr -d ' \t\r' \
  | cut -d, -f1 \
  | grep -E '^\+?[0-9]{6,15}$' \
  | awk '!seen[$0]++'
```

### 8.4 Envoyer (boucle — recommandée)

```bash
MSG="Rappel : réunion déplacée à 15h"
CSV=contacts.csv

tail -n +2 "$CSV" \
  | tr -d ' \t\r' \
  | cut -d, -f1 \
  | grep -E '^\+?[0-9]{6,15}$' \
  | awk '!seen[$0]++' \
  | while read -r num; do
      if kdeconnect-cli -d "$KC_DEVICE_ID" --send-sms "$MSG" --destination "$num"; then
        printf 'ok    %s\n' "$num"
      else
        printf 'ECHEC %s\n' "$num"
      fi
      sleep 1
    done
```

**Pourquoi une boucle plutôt qu'un appel unique ?** Le `sleep 1` espace les envois pour éviter
que l'opérateur bride ou signale le numéro en plein envoi. Cela rend aussi la commande
compatible avec toutes les versions de `kdeconnect-cli` (voir §8.5).

### 8.5 Variante mono-ligne (21.12.3+ uniquement)

Sur les versions **21.12.3 et ultérieures**, `--destination` accepte plusieurs numéros séparés
par des espaces, car la valeur est découpée sur les blancs :

```bash
kdeconnect-cli -d "$KC_DEVICE_ID" \
  --send-sms "$MSG" \
  --destination "+33612345678 +33698765432 +33655555555"
```

Vérifié dans le code source : `cli/kdeconnect-cli.cpp:347-364`.

> ⚠️ **Sur `kdeconnect` 1.4 (Ubuntu 20.04 focal), ce comportement n'existe pas.** La version
> ancienne passe la chaîne entière comme **un seul** destinataire, ce qui envoie vers un
> numéro invalide sans erreur visible. C'est pourquoi la boucle §8.4 est préférable :
> elle fonctionne sur toutes les versions.

### 8.6 Dry-run

Toujours tester la liste avant d'envoyer réellement :

```bash
tail -n +2 "$CSV" | tr -d ' \t\r' | cut -d, -f1 \
  | grep -E '^\+?[0-9]{6,15}$' | awk '!seen[$0]++' \
  | nl -w4 -s'. '
```

---

## 9. Intégration dans un script

Contraintes du binaire à respecter :

| Contrainte | Détail |
|---|---|
| Séparateur de destinataires | **Espace** (découpe sur `\s+`) |
| Format de numéro | E.164 recommandé (`+33612345678`) |
| Longueur d'une ligne de commande | Les numéros sont passés en argument — éviter les listes de plusieurs centaines |
| Retour d'erreur | `kdeconnect-cli` renvoie 0 même si l'envoi échoue côté opérateur ; `ECHEC` ci-dessus détecte surtout les échecs D-Bus |

Squelette de départ :

```bash
#!/usr/bin/env bash
set -euo pipefail

CSV="${1:?usage: script.sh contacts.csv \"message\"}"
MSG="${2:?usage: script.sh contacts.csv \"message\"}"

KC_DEVICE_ID="$(kdeconnect-cli -l 2>/dev/null \
  | grep 'paired and reachable' \
  | sed 's/^- [^:]*: //' \
  | cut -d' ' -f1 | head -1)"

[ -n "$KC_DEVICE_ID" ] || { echo "Aucun téléphone appairé" >&2; exit 1; }

sent=0; failed=0
while read -r num; do
  if kdeconnect-cli -d "$KC_DEVICE_ID" --send-sms "$MSG" --destination "$num"; then
    sent=$((sent+1)); printf 'ok    %s\n' "$num"
  else
    failed=$((failed+1)); printf 'ECHEC %s\n' "$num"
  fi
  sleep 1
done < <(tail -n +2 "$CSV" | tr -d ' \t\r' | cut -d, -f1 \
         | grep -E '^\+?[0-9]{6,15}$' | awk '!seen[$0]++')

printf '\n%d envoyés, %d échecs\n' "$sent" "$failed"
```

---

## 10. Limites et coûts

### 10.1 Le SMS est réellement facturé

Ce setup utilise la **SIM de ton téléphone**. Chaque destinataire = **un SMS payant**.

- Limite GSM : **160 caractères** par SMS (70 en Unicode). Au-delà, le message est **découpé
  en plusieurs SMS**, donc facturé en conséquence.
- 50 destinataires × message de 300 caractères = **100 SMS facturés**.

### 10.2 SMS uniquement, jamais RCS

KDE Connect envoie toujours en SMS/MMS, même si le destinataire a RCS activé. Bug connu
[#464654](https://bugs.kde.org/show_bug.cgi?id=464654), non corrigé depuis 2023.

### 10.3 L'interface graphique ne fait pas de broadcast

La zone de compose de `kdeconnect-sms` accepte **un seul destinataire à la fois**
(`isAddressValid()` valide une adresse unique). Le multi-destinataire n'existe que dans
l'API (`sendWithoutConversation`) et via le CLI. D'où la boucle §8.4.

### 10.4 Pourquoi un soft phone ne conviendrait pas

Un numéro VoIP / soft phone (VoIP.ms, Google Voice, TextNow) est **plus mauvais** ici :

- **A2P vs P2P** — depuis le 1er septembre 2023, les opérateurs US bloquent au niveau du
  réseau tout SMS/A2P envoyé depuis un numéro 10DLC non enregistré. Un SMS envoyé depuis
  une SIM personnelle est du trafic **P2P** et en est exempté.
- **Google Voice** interdit explicitement le cas d'usage visé dans ses CGU :
  *« Sending the same text message to multiple recipients »*. Sanction : blocage 24 h
  puis **suspension définitive**, sans portabilité possible du numéro.
- **VoIP.ms** exige un enregistrement de marque + campagne 10DLC, plafonné par défaut à
  **100 SMS/jour**, avec frais par segment côté AT&T.

Le vrai numéro est donc le bon choix : gratuit, reconnu par les destinataires, réponses
fiables.

---

## 11. Dépannage

### Le téléphone n'apparaît pas dans `-l`

```bash
kdeconnect-cli --list-backends        # LAN doit être 'enabled'
kdeconnect-cli --refresh              # forcer la redécouverte
```

Si la découverte échoue (réseau segmenté, isolation AP) : sur le téléphone,
**⋮ → Add device by IP**, et saisir l'IP de l'ordinateur directement.

### L'appairage fonctionne mais aucun SMS

Dans l'ordre de probabilité :

1. **Permissions SMS non accordées** (§4.1) — cause n°1
2. **Mauvaise build Android** — si c'est le Play Store, le SMS est absent. Vérifier que
   l'app vient bien de F-Droid.
3. **Plugin SMS désactivé** dans l'app Android (§4.3)
4. **Accès aux notifications** non activé (§4.2)

### Logs en direct

```bash
journalctl --user -f | grep -i kdeconnect
```

### Vérifier que le daemon tourne

```bash
systemctl --user list-units --all | grep kdeconnect
# attendu : dbus-:X.Y-org.kde.kdeconnect@0.service  active running
```

### Contacts sans nom dans `kdeconnect-sms`

Sans la permission **Contacts**, l'app affiche les numéros bruts au lieu des noms.

---

## 12. Interface web (optionnelle)

Le dossier [`app/`](app/) contient une interface web locale (HTML/CSS/JS + pont
Python standard) pour piloter le broadcast sans écrire de ligne de commande :
choix de l'appareil, message (saisi ou fichier), CSV de numéros, aperçu,
estimation du coût et progression en direct.

```bash
python3 /home/yanarion/Projet/phone_pq/app/server.py
# puis ouvrir http://127.0.0.1:8765/
```

Le serveur n'écoute que sur `127.0.0.1` et n'envoie rien tant que l'option
**Simulation** est cochée.

Les numéros peuvent être saisis **sans indicatif** : un champ *Indicatif par
défaut* (`+1`) est ajouté automatiquement, et reste modifiable pour viser un
autre pays. Un numéro commençant déjà par `+` est conservé tel quel.

Détails et API : [`app/README.md`](app/README.md).

---

## Commandes de référence

```bash
# Diagnostic
kdeconnect-cli --version
kdeconnect-cli -l
kdeconnect-cli -d <ID> --list-commands

# Réseau
kdeconnect-cli --refresh
kdeconnect-cli --enable-backend lan
kdeconnect-cli --disable-backend bluetooth

# Appairage — voir §5, se fait via l'interface graphique
kdeconnect-cli -d <ID> --ping

# SMS
kdeconnect-cli -d <ID> --send-sms "message" --destination "+33612345678"
kdeconnect-sms                                        # boîte de réception graphique

# Fichiers / divers
kdeconnect-cli -d <ID> --share /chemin/fichier
kdeconnect-cli -d <ID> --ring
```

---

## Références

- KDE Connect (desktop) : https://github.com/KDE/kdeconnect-kde
- KDE Connect (Android) : https://github.com/KDE/kdeconnect-android
- F-Droid : https://f-droid.org
- Package Android : https://f-droid.org/packages/org.kde.kdeconnect_tp/
- Bug RCS : https://bugs.kde.org/show_bug.cgi?id=464654
