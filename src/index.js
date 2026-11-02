// index.js
// -----------------------------------------------------------------------------
// Punto de entrada del proceso. Carga el .env y delega todo el cableado en
// src/main.js (modos, compuerta manual y veredicto). Ver DISENO-INTERFAZ 7.1.
// -----------------------------------------------------------------------------

import "dotenv/config";
import { main } from "./main.js";

const codigo = await main(process.argv.slice(2), process.env);
if (codigo !== null) process.exit(codigo);
