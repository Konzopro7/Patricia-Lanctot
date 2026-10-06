import { createOwnerInvite } from './auth.js';

const email=process.argv[2];
if (!email||!/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Usage: npm run setup-owner -- adresse@example.com');
  process.exit(1);
}
try {
  const token=createOwnerInvite(email);
  console.log('Lien de création du mot de passe (valide 48 h) :');
  console.log(`/admin/#invite=${token}`);
  console.log('Transmettez ce lien uniquement à la propriétaire du site.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
