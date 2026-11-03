import { migrate, pool } from '../src/db.js';

const applied = await migrate();
console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base déjà à jour.');
await pool.end();
