# Conditions Générales de Vente — Buildr

> ⚠️ **DOCUMENT À FAIRE RELIRE PAR UN AVOCAT AVANT MISE EN LIGNE.**
> Cette version est un premier jet professionnel pour un SaaS B2B
> du secteur du BTP, conçu pour être complémentaire aux **CGU**.
> Elle est destinée à être :
> 1. Adaptée aux **informations légales de l'éditeur** (placeholders `{{…}}`).
> 2. **Relue par un avocat spécialisé** en parallèle des autres docs légaux.
> 3. Mise en ligne à l'adresse `getbuildr.fr/cgv` **avant la première facturation**.
> 4. Acceptée explicitement (case à cocher) par l'Administrateur de l'Organisation lors de la souscription payante.
>
> **Version :** 1.0 — première rédaction.
> **Date :** 14 mai 2026.

---

## Préambule

Les présentes **Conditions Générales de Vente** (« **CGV** ») régissent la relation contractuelle entre **{{RAISON_SOCIALE}}** (ci-après « **Buildr** ») et toute Organisation souscrivant à un **Abonnement** payant à la plateforme Buildr.

Elles complètent les **Conditions Générales d'Utilisation** (« CGU ») et la **Politique de confidentialité**, qui forment ensemble le **Contrat** liant Buildr à l'Organisation.

En cas de contradiction entre les CGV et les CGU, **les CGV prévalent pour les questions de vente, de paiement et de facturation**. Les CGU prévalent pour les questions techniques et d'usage de la plateforme.

L'acceptation des présentes CGV est matérialisée par la case à cocher dédiée présentée à l'Administrateur de l'Organisation lors de la souscription payante.

---

## 1. Définitions

Les termes en majuscules non définis dans les présentes CGV ont le sens qui leur est donné dans les **CGU** (article 1).

À celles-ci s'ajoutent :

**Abonnement** : contrat par lequel l'Organisation accède aux Services de Buildr en contrepartie du paiement périodique d'un prix.

**Date d'effet** : date à laquelle l'Abonnement entre en vigueur, correspondant à la date d'acceptation des CGV et de validation du premier paiement.

**Facture** : document comptable émis par Buildr à l'Organisation conformément à la réglementation française et européenne.

**Organisation Cliente** : Organisation ayant souscrit un Abonnement payant. Désignée également « **le Client** » dans les présentes CGV.

**Période d'Engagement** : durée minimale d'engagement de l'Organisation Cliente (mois ou année), pendant laquelle l'Abonnement ne peut être résilié qu'au terme.

**Prix Unitaire** : prix mensuel ou annuel hors taxes facturé par Siège Facturable.

**Siège Facturable** : tel que défini dans les CGU article 1.

---

## 2. Souscription à l'Abonnement

### 2.1 Capacité

La souscription à un Abonnement est réservée aux **personnes morales et personnes physiques majeures et capables agissant à titre professionnel**, dans les conditions d'éligibilité géographique précisées à l'article 3.1 des CGU (France, Belgique, Luxembourg, Suisse).

Le souscripteur déclare disposer du pouvoir d'engager l'Organisation qu'il représente.

### 2.2 Processus de souscription

La souscription s'effectue :

1. depuis le tableau de bord, par un Administrateur de l'Organisation ;
2. ou via un lien d'invitation transmis par Buildr ou un partenaire commercial.

L'Administrateur :

- sélectionne la formule et la périodicité (mensuelle ou annuelle) ;
- renseigne ou confirme les informations légales de l'Organisation (raison sociale, SIRET, adresse de facturation, TVA intracommunautaire) ;
- accepte expressément les CGV, les CGU et la Politique de confidentialité ;
- communique ses informations de paiement via la solution **Stripe**.

L'Abonnement est conclu à la **Date d'effet**, c'est-à-dire après validation du premier paiement par Stripe.

---

## 3. Formules d'Abonnement et Prix

### 3.1 Formule Pro

L'offre « **Pro** » est facturée **{{PRIX_UNITAIRE}} € HT / Siège Facturable / mois** (ou un montant annuel équivalent avec remise éventuelle).

Sont facturés par Siège Facturable les Membres disposant des rôles **Administrateur**, **Manager** et **Employé**.

Les rôles **Client** et **Gestionnaire de réseau** sont **gratuits** et ne consomment pas de Siège.

Les fonctionnalités incluses sont décrites en détail sur la page <https://getbuildr.fr/pricing> et dans le tableau de bord, et incluent notamment :

- Chantiers, étapes et sous-étapes illimités ;
- Photos et documents illimités ;
- Discussions et notifications temps réel ;
- Application mobile iOS et Android ;
- Gestion des équipes et permissions granulaires ;
- Synchronisation calendriers (Google, Outlook, Apple) ;
- API et webhooks ;
- Support par courriel sous 24 heures ouvrées ;
- Hébergement européen.

### 3.2 Formule Enterprise

Pour les Organisations dépassant **{{SEUIL_ENTERPRISE}} Sièges Facturables** ou ayant des besoins spécifiques (SLA renforcé, SSO/SAML, hébergement dédié, intégrations sur mesure, onboarding personnalisé), une offre **Enterprise** est proposée **sur devis**.

Les conditions particulières (prix, SLA, support dédié) sont précisées dans un **contrat cadre** signé séparément, qui prévaut sur les présentes CGV pour les Organisations Enterprise.

Contact : `contact@getbuildr.fr`.

### 3.3 Période d'essai

Sauf indication contraire au moment de la souscription, **aucune période d'essai gratuite** n'est proposée par défaut. Les Organisations souhaitant évaluer la plateforme peuvent demander une démonstration.

### 3.4 Conversion devises et taxes

Les prix sont indiqués **en euros (€), hors taxes**. La **TVA française** au taux en vigueur est appliquée aux Organisations établies en France, ou aux Organisations européennes ne fournissant pas de numéro de TVA intracommunautaire valide.

Pour les Organisations européennes assujetties disposant d'un numéro de TVA intracommunautaire valide, l'**auto-liquidation** de la TVA s'applique (article 196 de la directive 2006/112/CE).

Toute évolution des taux de TVA ou de toute autre taxe applicable est répercutée automatiquement sur les Factures émises à compter de l'évolution, sans que cela ne constitue un motif de résiliation pour le Client.

---

## 4. Modalités de paiement

### 4.1 Moyens de paiement acceptés

Buildr accepte les moyens de paiement suivants, gérés via la solution de paiement **Stripe Payments Europe Ltd** :

- carte bancaire (Visa, Mastercard, American Express) ;
- prélèvement SEPA (Direct Debit) pour les Organisations européennes ;
- virement bancaire pour les Abonnements annuels supérieurs à **{{SEUIL_VIREMENT}} €** HT (sur demande).

L'utilisation des moyens de paiement gérés par Stripe suppose l'acceptation des conditions particulières de Stripe disponibles à <https://stripe.com/legal>.

### 4.2 Fréquence de facturation

- **Abonnement mensuel** : facturé chaque mois à la **Date d'effet** anniversaire ;
- **Abonnement annuel** : facturé en une fois à la Date d'effet, puis chaque année anniversaire.

### 4.3 Variation du nombre de Sièges en cours de période

Le nombre de Sièges Facturables peut varier en cours de période. Les ajustements sont calculés comme suit :

- **Ajout d'un Siège** : prorata temporis facturé sur la prochaine échéance ;
- **Retrait d'un Siège** : avoir prorata temporis crédité sur la prochaine échéance ;
- Aucun remboursement immédiat n'est dû en cas de retrait.

L'évolution des Sièges est visible en temps réel dans la section « Facturation » du tableau de bord.

---

## 5. Facture et comptabilité

Buildr émet une **Facture électronique** à chaque échéance de paiement, accessible depuis l'espace « Facturation » du tableau de bord et envoyée par courriel à l'adresse de facturation renseignée par l'Organisation.

Les Factures sont conformes aux exigences légales françaises :

- mention de la raison sociale et SIREN de Buildr et du Client ;
- numéro de Facture séquentiel ;
- date d'émission ;
- montant HT et TTC, taux de TVA appliqué ;
- numéro de TVA intracommunautaire des parties ;
- conditions et modalités de paiement.

Les Factures sont conservées pendant **dix (10) ans** conformément à l'article L. 123-22 du Code de commerce.

---

## 6. Retard de paiement

### 6.1 Pénalités de retard

En cas de retard de paiement, Buildr est en droit d'appliquer, sans mise en demeure préalable, des **pénalités de retard** calculées au taux d'intérêt **trois (3) fois le taux d'intérêt légal en vigueur** à compter de la date d'échéance, conformément à l'article L. 441-10 du Code de commerce.

### 6.2 Indemnité forfaitaire pour frais de recouvrement

Tout professionnel en situation de retard de paiement est, de plein droit, débiteur à l'égard du créancier d'une **indemnité forfaitaire pour frais de recouvrement de quarante (40) euros**, conformément à l'article D. 441-5 du Code de commerce. Cette indemnité ne fait pas obstacle à la demande de remboursement de frais de recouvrement supérieurs sur justification.

### 6.3 Suspension d'accès

À défaut de régularisation **sept (7) jours** après une mise en demeure restée infructueuse, Buildr peut **suspendre l'accès** de l'Organisation à la plateforme jusqu'à complet règlement.

La suspension d'accès ne dispense pas l'Organisation Cliente du paiement des sommes dues, ni des Abonnements en cours.

---

## 7. Durée et reconduction

### 7.1 Durée initiale

L'Abonnement est conclu pour une **durée initiale d'un (1) mois** ou **d'un (1) an** selon la périodicité choisie par le Client à la souscription.

### 7.2 Reconduction tacite

À l'expiration de la Période d'Engagement initiale, l'Abonnement se **reconduit tacitement** pour des périodes successives de durée identique, sous réserve du paiement des Factures aux échéances convenues.

### 7.3 Information sur la reconduction tacite

Conformément à l'article L. 215-1 du Code de la consommation lorsqu'il s'applique, et à titre de bonne pratique commerciale, Buildr informe le Client **par courriel au moins trente (30) jours avant la date de reconduction**, lui rappelant ses possibilités de résiliation.

---

## 8. Résiliation

### 8.1 Résiliation par le Client

L'Administrateur peut résilier l'Abonnement à tout moment :

- depuis le tableau de bord, section « Facturation » → « Résilier mon abonnement » ;
- ou par courriel à `support@getbuildr.fr`.

La résiliation prend effet **au terme de la période d'Abonnement en cours**, sous réserve d'un préavis minimum de **trente (30) jours** avant l'échéance.

Aucun remboursement n'est dû pour la période restant à courir entre la demande de résiliation et l'échéance.

### 8.2 Résiliation par Buildr

Buildr peut résilier l'Abonnement à tout moment avec un préavis de **soixante (60) jours**, sans avoir à motiver sa décision.

Buildr peut également **résilier sans préavis** :

- en cas de manquement grave du Client à ses obligations contractuelles, dans les conditions de l'article 10 des CGU (Sanctions) ;
- en cas de défaut de paiement persistant après mise en demeure ;
- en cas de procédure collective ouverte à l'encontre du Client (sauvegarde, redressement, liquidation), dans le respect des dispositions légales applicables.

### 8.3 Conséquences de la résiliation

À la prise d'effet de la résiliation :

- l'accès aux Services est désactivé ;
- les données de l'Organisation restent accessibles **en lecture seule pendant trente (30) jours** afin de permettre un export complet par l'Administrateur ;
- les sauvegardes techniques sont purgées dans un délai supplémentaire de **trente (30) jours** ;
- les obligations légales d'archivage du Client (notamment relatives aux documents BTP) demeurent à sa charge ; il appartient au Client de procéder à un export complet avant l'expiration du délai de lecture seule.

---

## 9. Modification des prix

Buildr se réserve le droit de modifier les Prix Unitaires à tout moment.

Toute modification est notifiée au Client par courriel **au moins trente (30) jours avant son entrée en vigueur**.

En cas de désaccord sur le nouveau prix, le Client peut résilier son Abonnement **sans pénalité** avant la date d'entrée en vigueur du nouveau prix, en notifiant sa résiliation par courriel à `support@getbuildr.fr`. À défaut, le nouveau prix est réputé accepté.

Les modifications de TVA ou d'autres taxes prévues à l'article 3.4 ne sont pas soumises à ce préavis et s'appliquent automatiquement.

---

## 10. Garanties et limitation de responsabilité

### 10.1 Obligation de moyens

Buildr est tenue à une **obligation de moyens** au titre de la fourniture des Services. Buildr s'engage à mettre en œuvre les diligences nécessaires pour assurer la disponibilité, la sécurité et la performance de la plateforme, dans les conditions des CGU (articles 14 et 15).

### 10.2 Disponibilité

Hors phase Beta et hors conditions spécifiques d'une offre Enterprise, **Buildr n'accorde aucun engagement de niveau de service (SLA) en pourcentage d'uptime contractualisé** sur la formule Pro. Buildr s'efforce néanmoins d'assurer la meilleure disponibilité possible et publie, le cas échéant, ses incidents et maintenance sur une **page de statut** dédiée.

### 10.3 Plafond de responsabilité

**En toute hypothèse, et sauf en cas de dol ou de faute lourde, la responsabilité totale de Buildr au titre du présent Contrat est limitée à l'indemnisation des dommages directs prouvés et plafonnée à un montant maximum correspondant aux sommes effectivement versées par l'Organisation Cliente au titre des douze (12) mois d'Abonnement précédant le fait générateur du dommage.**

**Buildr ne pourra en aucun cas être tenue à l'indemnisation de dommages indirects, et notamment de pertes de chiffre d'affaires, de marge, de bénéfices, d'exploitation, d'opportunité commerciale, de clientèle, d'image, ou de réputation.**

### 10.4 Assurance

Buildr atteste être titulaire d'une **assurance responsabilité civile professionnelle** couvrant les conséquences pécuniaires de la mise en jeu de sa responsabilité, dans les conditions et limites de la police souscrite.

---

## 11. Programme partenaire

À titre indicatif, et sous réserve d'évolution :

- Un Client peut **parrainer** une autre Organisation et bénéficier d'un avoir d'un mois d'Abonnement par filleul ayant souscrit un Abonnement payant pendant au moins trois (3) mois consécutifs.
- Un partenaire commercial (consultant, intégrateur, syndicat professionnel) peut être référencé comme **revendeur** ou **apporteur d'affaires** dans le cadre d'un contrat spécifique signé séparément.

Les conditions exactes du programme partenaire sont publiées à <https://getbuildr.fr/partners> *(le cas échéant)*.

---

## 12. Données personnelles et confidentialité

Les conditions de traitement des données personnelles, y compris la **Convention de Sous-Traitance des Données Personnelles** (article 28 RGPD), sont décrites :

- dans la **Politique de confidentialité** : <https://getbuildr.fr/privacy> ;
- en **Annexe A** des Conditions Générales d'Utilisation : <https://getbuildr.fr/cgu>.

L'acceptation des CGV emporte acceptation de la Convention de Sous-Traitance.

---

## 13. Modification des CGV

Buildr peut modifier les présentes CGV à tout moment dans les conditions de l'article 16 des CGU, **moyennant un préavis de trente (30) jours** notifié au Client par courriel.

En cas de désaccord substantiel avec les nouvelles CGV, le Client peut résilier son Abonnement avant l'entrée en vigueur de la nouvelle version, **sans pénalité ni préavis supplémentaire**.

---

## 14. Force majeure, cession et non-sollicitation

Les dispositions relatives à la **force majeure**, à la **cession** des droits et obligations, à la **non-sollicitation** des collaborateurs et prestataires, à l'**autonomie des clauses** et à la **renonciation** prévues à l'article 18 des CGU s'appliquent intégralement aux présentes CGV.

---

## 15. Loi applicable et juridiction

Les présentes CGV sont régies par le **droit français**.

**Tout différend relatif à la validité, l'interprétation, l'exécution ou la résiliation des présentes CGV, à défaut de résolution amiable dans un délai de trente (30) jours à compter de la première notification écrite par l'une des Parties, relèvera de la compétence exclusive des tribunaux du ressort de la Cour d'appel de {{COUR_APPEL}}**, y compris en cas de référé, de procédure conservatoire, de pluralité de défendeurs ou d'appel en garantie.

---

## 16. Contact

Pour toute question relative aux présentes CGV, au paiement ou à la facturation :

- **Support général** : `support@getbuildr.fr`
- **Service comptabilité / facturation** : `billing@getbuildr.fr`
- **Service commercial (offre Enterprise)** : `contact@getbuildr.fr`
- **Adresse postale** : {{SIEGE_ADRESSE}}

---

**Fin des Conditions Générales de Vente.**

*Version 1.0 — Première rédaction — 14 mai 2026*
*À faire relire par un avocat avant publication*
