# Buildr — Email (réception et envoi)

Document de référence pour la messagerie du domaine `getbuildr.fr` :
qui reçoit, qui envoie, et quels enregistrements DNS rendent ces envois
légitimes.

**Dernière mise à jour :** 25 août 2026
**Domaine :** `getbuildr.fr`
**Zone DNS faisant autorité :** Scaleway (`ns0.dom.scw.cloud`, `ns1.dom.scw.cloud`)

---

## 1. Vue d'ensemble

Deux flux distincts, sur **deux noms différents**. C'est le point le plus
important du document : le courrier humain part du domaine racine, les
mails de l'application partent d'un sous-domaine dédié. Chacun
s'authentifie séparément, avec ses propres enregistrements.

```
        RÉCEPTION + COURRIER HUMAIN        ENVOI TRANSACTIONNEL
                                        (invitations, reset mot de passe)

        @getbuildr.fr                        @mail.getbuildr.fr
   contact@ (boîte réelle)                        │
   support@ (alias)                               │
   privacy@ (alias)                               │
          │                                       │
          ▼                                       ▼
   OVH Zimbra Starter                    Scaleway Transactional Email
   3,60 € /an HT, 1 compte               région PAR
   engagement jusqu'au 22/08/2027        réputation 100 « Excellent »
          │                                       │
          └────────────────┬──────────────────────┘
                           ▼
                Zone DNS chez Scaleway
       racine : MX OVH + SRV + DKIM ×2 + DMARC
       mail.  : SPF + MX blackhole + DKIM + DMARC
```

Séparer les deux noms est une bonne pratique, pas un accident : la
réputation d'expédition de l'application n'entame pas celle du courrier
humain, et inversement. Conséquence directe et contre-intuitive : **la
racine n'a pas besoin d'autoriser Scaleway TEM**, puisque TEM n'expédie
jamais en `@getbuildr.fr`.

Point structurant : **la zone DNS est chez Scaleway**, pas chez OVH. OVH
ne peut donc rien configurer automatiquement — tous les enregistrements
se créent à la main dans la console Scaleway.

---

## 2. État de la configuration

### Fait

Côté OVH Zimbra :

- Plateforme provisionnée, organisation « PG TERRASSEMENT »
- Domaine `getbuildr.fr` ajouté et **vérifié** (CNAME de propriété vers
  `ovh.com.`, laissé en place)
- Compte `contact@getbuildr.fr` créé — offre Starter, quota 15 Gio
- Alias `support@getbuildr.fr` et `privacy@getbuildr.fr` actifs,
  **réception validée par un envoi réel** le 23 août 2026
- Webmail : https://webmail.mail.ovh.net/
- Serveur de la plateforme : `zimbra1.mail.ovh.net` (46.105.75.174) —
  c'est l'hôte à renseigner pour une configuration IMAP manuelle

- Signature **DKIM activée** côté service (l'activation est un
  interrupteur distinct de la pose des enregistrements : tant qu'il est
  sur off, OVH affiche « DKIM désactivé » même avec les CNAME en place)

Côté zone DNS Scaleway :

```
MX     1 mx0.mail.ovh.net.      SRV    _autodiscover._tcp
       5 mx1.mail.ovh.net.             0 0 443 zimbra1.mail.ovh.net.
      50 mx2.mail.ovh.net.
     100 mx3.mail.ovh.net.

DKIM   ovhmo-selector-1._domainkey → ovhmo-selector-1._domainkey.4830176.cr.dkim.mail.ovh.net.
       ovhmo-selector-2._domainkey → ovhmo-selector-2._domainkey.4830177.cr.dkim.mail.ovh.net.

DMARC  _dmarc  TXT  "v=DMARC1; p=none; rua=mailto:contact@getbuildr.fr; fo=1"
```

**Vérifié par un envoi réel vers Gmail le 23 août 2026** :
`dkim=pass header.i=@getbuildr.fr header.s=ovhmo-selector-1`, et
`spf=none` (attendu, le SPF n'est pas encore posé). Le domaine DKIM
(`d=getbuildr.fr`) est **aligné** avec le `From:`, donc DMARC passe déjà
sur le seul DKIM. À noter : OVH ne signe que l'en-tête `From` (`h=From`)
en plus du corps — signature minimale, mais suffisante pour l'alignement.

Côté envoi transactionnel — **déjà en place**, constaté dans la console
Scaleway le 23 août 2026 : domaine d'expédition `mail.getbuildr.fr`,
région PAR, score de réputation 100 « Excellent », 2 mails traités, 2
délivrés, 0 rejeté. Sa zone est complète :

```
mail.getbuildr.fr   TXT  "v=spf1 include:_spf.tem.scaleway.com -all"
                    MX   0 blackhole.tem.scaleway.com.
_dmarc.mail.…       TXT  "v=DMARC1; p=none"
```

Le MX `blackhole` est normal : c'est un puits à bounces, le sous-domaine
n'a pas à recevoir de courrier.

- **SPF de la racine** posé le 23 août 2026 :
  `v=spf1 include:mx.ovh.com -all`

Côté configuration de l'API en production — **vérifié le 25 août 2026**
sur le VPS (`/home/buildr/api/.env`) :

```
RESEND_API_KEY=            (vide — la branche Resend est bien inerte)
SMTP_FROM=noreply@mail.getbuildr.fr
SMTP_HOST=smtp.tem.scaleway.com
SMTP_PORT=2587
```

L'expéditeur est bien sur le **sous-domaine**, seul nom déclaré comme
domaine d'expédition dans TEM. Le port 2587 est le port STARTTLS de
Scaleway : `secure` reste à `false` dans le code (activé pour 465 et 2465
seulement), nodemailer négocie donc STARTTLS — c'est le comportement
attendu, pas un oubli.

### Reste à faire

- Test d'envoi transactionnel réel et lecture de l'en-tête reçu
  (section 7, point 2). Tentative du 25 août 2026 restée sans envoi :
  voir l'avertissement en section 7.

### Le piège du point final

Scaleway interprète toute cible sans point final comme un nom
**relatif** et lui recolle le domaine. Le SRV a d'abord été créé en
`zimbra1.mail.ovh.net.getbuildr.fr.`, sans aucun message d'erreur. La
vérification qui tranche, en interrogeant les serveurs autoritaires pour
contourner les caches :

```bash
dig @ns0.dom.scw.cloud +short MX getbuildr.fr
dig @ns0.dom.scw.cloud +short SRV _autodiscover._tcp.getbuildr.fr
```

Un résolveur public peut renvoyer une réponse partielle en cache — trois
MX sur quatre par exemple. Ce n'est pas une erreur de configuration.

Autre décalage observé : `ns0` et `ns1` ne se synchronisent pas
instantanément. Le SPF racine était visible sur `ns1` alors que `ns0` le
renvoyait encore vide, la convergence prenant moins d'une minute. Tant
que les deux ne concordent pas, un test de délivrabilité peut renvoyer
`spf=none` selon le serveur interrogé : interroger les deux avant de
conclure.

## 3. Adresses

L'offre Zimbra Starter ne comprend **qu'un seul compte**. Les autres
adresses sont donc des alias, qui ne consomment pas de licence.

| Adresse | Type | Usage |
|---|---|---|
| `contact@getbuildr.fr` | compte réel | boîte unique, relevée par un humain |
| `support@getbuildr.fr` | alias | contact de support cité à Apple et dans les pages légales |
| `privacy@getbuildr.fr` | alias | demandes RGPD citées dans la politique de confidentialité |
| `…@mail.getbuildr.fr` | expéditeur seul | `SMTP_FROM` de l'API, sur le **sous-domaine**, ne reçoit rien |

L'expéditeur transactionnel n'a pas besoin d'exister comme boîte, mais il
doit être sur `mail.getbuildr.fr` : c'est ce nom-là qui est déclaré comme
domaine d'expédition dans Scaleway TEM, pas la racine.

---

## 4. Configuration OVH Zimbra

1. Espace client OVH → **Web Cloud** → *E-mails* / *Zimbra* → la
   plateforme → ajouter le domaine `getbuildr.fr`.
2. OVH détecte que la zone DNS est externe et bascule en **configuration
   manuelle** : il affiche alors la liste exacte des enregistrements à
   créer. **Cette liste est la source de vérité** — les valeurs MX et le
   sélecteur DKIM dépendent de la plateforme Zimbra attribuée au compte,
   ils ne se devinent pas.
3. Créer le compte `contact@getbuildr.fr`.
4. Créer les alias `support@` et `privacy@` pointant sur ce compte.
5. Vérifier dans la fiche de l'offre si **IMAP** est inclus : cela
   détermine si la boîte peut être branchée dans un client mail ou si
   elle reste accessible uniquement par le webmail.

---

## 5. Enregistrements DNS à créer dans la zone Scaleway

### MX

Sans MX, aucune réception possible. Valeurs posées (voir section 2) :
priorités 1, 5, 50 et 100 vers `mx0` à `mx3.mail.ovh.net.`, avec le point
final. Elles proviennent de la page *Diagnostics* du domaine chez OVH,
qui reste la référence si la plateforme change.

### SPF de la racine

Un TXT à la racine, autorisant **uniquement OVH**. Scaleway TEM n'a pas à
y figurer : il expédie en `@mail.getbuildr.fr`, un nom qui a déjà son
propre SPF.

```
getbuildr.fr.  TXT  "v=spf1 include:mx.ovh.com -all"
```

Vérifié le 23 août 2026 : `mx.ovh.com` publie
`v=spf1 ptr:mail-out.ovh.net ptr:mail.ovh.net ip4:8.33.137.105/32 ip4:192.99.77.81/32 ?all`.
Le mécanisme `ptr:` couvre bien les sortants Zimbra — l'IP observée
46.105.32.219 a pour reverse `10.mo534.mail-out.ovh.net`.

Deux règles à ne pas oublier si ce SPF évolue un jour :

- **Un seul enregistrement SPF par nom.** Deux TXT `v=spf1` sur le même
  nom s'annulent et le domaine se retrouve sans SPF valide. Tout doit
  tenir dans une seule chaîne.
- Si un jour l'API doit expédier en `@getbuildr.fr` plutôt qu'en
  `@mail.getbuildr.fr`, il faudra ajouter `include:_spf.tem.scaleway.com`
  à cette chaîne **et** faire vérifier la racine comme domaine
  d'expédition dans TEM. Le `-all` fait échouer tout envoi non prévu, ce
  qui est l'effet recherché mais ne pardonne pas les oublis.

### DKIM — deux sélecteurs

Il faut **les deux** signatures : celle d'OVH/Zimbra et celle du
prestataire transactionnel. Les sélecteurs étant différents, elles
cohabitent sans conflit. N'en poser qu'une laisse la moitié des mails
non signés.

### DMARC

Commencer permissif, lire les rapports, puis durcir vers `p=quarantine`
et enfin `p=reject`.

```
_dmarc.getbuildr.fr.  TXT  "v=DMARC1; p=none; rua=mailto:contact@getbuildr.fr"
```

---

## 6. Envoi transactionnel — ce que fait le code

`src/lib/mailer.ts`, fonction `sendMail()`, choisit le canal dans cet
ordre :

1. `RESEND_API_KEY` défini → **Resend**, via son API HTTP.
2. Sinon `SMTP_HOST` défini → **SMTP** (nodemailer).
3. Sinon → le mail est seulement loggé, rien n'est envoyé.

En production, c'est la branche SMTP qui sert : le domaine d'expédition
`mail.getbuildr.fr` est déclaré et actif dans Scaleway TEM. Resend
apparaît encore dans le code et dans `.env.production.example`, mais ne
correspond à aucune infrastructure réelle du projet — c'est un vestige de
l'ancien plan d'hébergement.

Corollaire à garder en tête : `SMTP_FROM` doit rester sur
`@mail.getbuildr.fr`. La valeur par défaut du code est
`noreply@getbuildr.fr`, sur la **racine**, qui n'est pas un domaine
d'expédition vérifié dans TEM. Un déploiement qui oublierait cette
variable verrait donc ses mails refusés par TEM, ou partir sans
alignement DMARC.

Détails d'implémentation utiles :

- **Port TLS** : `secure` est activé pour 465 et 2465 (2465 est le port
  de Scaleway TEM). Sur 587 et 2587, nodemailer négocie STARTTLS.
- **Version texte** : `htmlToText()` dérive systématiquement une partie
  texte du HTML. Un message HTML seul est un signal négatif fort pour les
  filtres anti-spam.
- **Nom d'expéditeur** : `fromAddress()` enveloppe `SMTP_FROM` en
  `Buildr <adresse>` s'il ne contient pas déjà de chevrons.

Variables concernées (`src/config/env.ts`) : `RESEND_API_KEY`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.

---

## 7. Vérification

```bash
dig +short MX getbuildr.fr
dig +short TXT getbuildr.fr
dig +short TXT _dmarc.getbuildr.fr
```

Puis deux tests réels, puisque les deux flux s'authentifient séparément :

1. **Réception et envoi humain** : depuis le webmail Zimbra, envoyer vers
   une adresse Gmail, ouvrir *Afficher l'original* et vérifier
   `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. Répondre pour valider la
   réception, et tester les deux alias.
2. **Envoi transactionnel** : déclencher une **invitation** depuis le
   dashboard (compte admin ou manager), puis refaire la même
   vérification sur l'en-tête reçu.

   **Prendre l'invitation, pas la réinitialisation de mot de passe.**
   `forgotPassword()` sort avant `sendMail()` si l'adresse ne correspond
   à aucun compte actif, et renvoie malgré tout le même message que sur
   un succès — c'est volontaire, pour ne pas permettre d'énumérer les
   comptes. Un test sur une adresse sans compte semble donc réussir
   alors que rien n'est parti : c'est exactement ce qui s'est produit le
   25 août 2026, l'API a répondu `200` et aucun mail n'a été tenté.
   `invite()` (`src/modules/invitation/invitation.service.ts:47`) expédie
   à n'importe quelle adresse, ce qui en fait le seul déclencheur fiable
   tant qu'aucun compte de test n'existe en prod.

   Deux destinataires valent mieux qu'un : une boîte **Gmail** pour lire
   `spf=` / `dkim=` / `dmarc=` dans *Afficher l'original*, et l'adresse
   jetable de **mail-tester.com** pour le score consolidé. Sur ce
   dernier, le lien `buildr://invite/...` du template peut être compté
   comme lien mort — faux positif, le lien web de repli suit juste
   après.

Un passage sur `mail-tester.com` donne un score consolidé et signale les
oublis (reverse DNS absent, DMARC trop permissif, etc.).

---

## 8. Points ouverts

- [x] Domaine ajouté et vérifié dans Zimbra, compte `contact@` créé,
      alias `support@` et `privacy@` créés
- [x] MX d'OVH posés dans la zone Scaleway
- [x] SRV d'autodiscover posé
- [x] Test de réception réel vers `support@getbuildr.fr` — OK le 23 août 2026
- [x] DKIM d'OVH posé et signature activée — `dkim=pass` confirmé
- [x] Prestataire transactionnel identifié : **Scaleway TEM**, domaine
      d'expédition `mail.getbuildr.fr` déjà vérifié, SPF/DKIM/DMARC en
      place sur ce sous-domaine
- [x] SPF de la racine posé : `v=spf1 include:mx.ovh.com -all`
- [x] `SMTP_FROM` de la prod vérifié le 25 août 2026 :
      `noreply@mail.getbuildr.fr`, `RESEND_API_KEY` vide, envoi via
      `smtp.tem.scaleway.com:2587`
- [ ] Test d'envoi transactionnel réel — **à faire à la création du
      premier vrai compte**, via une invitation envoyée depuis le
      dashboard (cf. section 7). Reporté le 25 août 2026 faute de compte
      actif en prod.
- [ ] **DKIM de Scaleway TEM : présence non vérifiée.** Aucun
      enregistrement trouvé sur `mail.getbuildr.fr` avec les sélecteurs
      usuels (`default`, `scw`, `tem`, `scaleway`, `smtp`) le 25 août
      2026. Le sélecteur de TEM n'étant pas devinable, cela ne prouve
      pas son absence — c'est le test réel qui tranchera. Si `dkim=none`
      apparaît dans l'en-tête reçu, récupérer l'enregistrement exact
      dans la console TEM et le poser dans la zone.
- [x] DMARC en `p=none` posé le 23 août 2026 — durcissement vers
      `quarantine` puis `reject` après lecture des premiers rapports
- [ ] `docs/HOSTING.md` décrit encore l'ancien plan (Cloudflare + Resend)
      qui ne correspond plus à l'infrastructure réelle : à reprendre

Voir aussi `docs/HOSTING.md` et `docs/DEPLOYMENT-PLAN.md`.
