# Site de Patricia Lanctot

Le site public reste une page statique. Le serveur Node.js sert aussi la page d’administration, l’API de rendez-vous et la base SQLite. Il faut Node.js 22.16 ou plus récent.

## Démarrer en local

1. Copier .env.example vers .env et ajuster les valeurs nécessaires.
2. Installer les dépendances avec npm install.
3. Démarrer avec npm start.
4. Ouvrir http://localhost:3000.

Les tables sont créées et mises à niveau au démarrage. Le fichier de base par défaut se trouve dans server/data/site.sqlite; il est ignoré par Git et doit être sauvegardé sur l’hébergement.

## Créer le premier compte propriétaire

Sur le serveur, exécuter npm run setup-owner -- adresse-de-la-proprietaire@example.com. La commande crée un compte propriétaire et affiche un lien privé de création de mot de passe. Ouvrir ce lien sur le domaine de l’administration dans les 48 heures. La commande ne crée aucun mot de passe et aucun secret n’est enregistré dans le dépôt.

## Rôles

| Rôle | Accès |
| --- | --- |
| Propriétaire | Rendez-vous, horaires, paramètres, membres de l’équipe |
| Administrateur | Rendez-vous, horaires et paramètres |
| Équipe | Consultation et gestion des rendez-vous |
| Lecture seule | Consultation des rendez-vous |

La propriétaire invite une personne dans « Équipe et accès ». Le lien affiché est aussi envoyé par courriel lorsque les paramètres SMTP sont configurés. Un rôle peut être modifié et un compte désactivé; cette action révoque ses sessions.

## Mise en ligne

Le dépôt est publié sur GitHub Pages, qui ne peut pas exécuter l’API ni stocker les rendez-vous. Il faut héberger l’application Node.js sur un service qui prend en charge Node 24, un processus persistant et le stockage durable de fichiers. Un hébergement cPanel convient seulement si l’option « Setup Node.js App » est disponible. L’administration doit être ouverte sur l’origine du serveur Node.js, par exemple https://admin.votre-domaine.example/admin/.

Si le site public continue d’être servi par GitHub Pages et l’API se trouve sur un autre domaine :

- définir PUBLIC_ORIGIN exactement à https://konzopro7.github.io;
- définir ADMIN_BASE_URL à l’origine HTTPS du serveur;
- configurer apiBaseUrl dans assets/site-config.js avec l’origine HTTPS de l’API;
- ajouter cette même origine dans la directive connect-src de la politique CSP de index.html;
- activer HTTPS et configurer DB_FILE dans un dossier persistant non public.

Pour servir le site et l’API depuis une seule origine, laisser apiBaseUrl vide et ouvrir le site via le serveur Node.js.

## Courriels

Le site n’avait pas de service de courriel côté serveur. Les notifications (nouvelle demande, accusé de réception, décision, déplacement et invitation) sont placées dans une file locale. Pour activer l’envoi, renseigner SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS et SMTP_FROM dans l’environnement du serveur. Les identifiants doivent rester dans l’environnement ou un gestionnaire de secrets, jamais dans les fichiers suivis par Git. Les échecs sont réessayés automatiquement.

Le formulaire de message général garde son ouverture de l’application courriel. Les demandes de rendez-vous sont enregistrées avec le statut PENDING; les créneaux en attente ou confirmés sont exclus des disponibilités. Le serveur recalcule chaque plage et protège les réservations concurrentes avec une transaction SQLite et des déclencheurs anti-chevauchement.

## Rôles et sécurité

Les mots de passe sont dérivés avec scrypt; les sessions sont stockées sous forme de hash et livrées dans un cookie HttpOnly. Les mutations administratives vérifient un jeton CSRF. Les pages publiques ne reçoivent que des dates disponibles et des heures, jamais les coordonnées d’autres clients. Les demandes publiques sont validées côté serveur et limitées en fréquence.

## Tests

Exécuter npm test. Les tests couvrent le calcul hebdomadaire, les périodes bloquées, les créneaux occupés, le déplacement et les permissions.
