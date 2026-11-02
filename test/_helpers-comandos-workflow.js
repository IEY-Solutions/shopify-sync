// Simulador del parser de comandos de workflow del runner de GitHub Actions.
// Lo comparten CA-6 (test/compuerta-manual-workflow.test.js) y CA-15
// (test/compuerta-no-aplicada.test.js, caso 8). Sin `.test.js`: `npm test`
// corre `node --test test/*.test.js` y este archivo no entra como suite.
//
// MODELO (ronda 5b). Sale del codigo fuente de actions/runner, rama main,
// verificado por el orquestador el 02/11/2026:
//
//   - src/Runner.Worker/ActionCommandManager.cs, TryProcessCommand:
//       if (!ActionCommand.TryParseV2(input, _registeredCommands, out actionCommand) &&
//           !ActionCommand.TryParse(input, _registeredCommands, out actionCommand)) return false;
//     Prueba primero el formato "::" (V2) y despues el formato viejo "##[",
//     SIN flag que apague el viejo.
//   - src/Runner.Common/ActionCommand.cs, TryParseV2:
//       message = message.TrimStart(); if (!message.StartsWith("::")) ...
//     Desescapa %0D, %0A y %25 dentro del comando.
//   - src/Runner.Common/ActionCommand.cs, TryParse (formato viejo):
//       int prefixIndex = message.IndexOf(Prefix);   // Prefix = "##["
//     Busca "##[" en CUALQUIER posicion de la linea y sin recortar. Desescapa
//     %3B, %0D, %0A, %5D y %25.
//   - El token de stop-commands se compara con StringComparison.OrdinalIgnoreCase.
//
// Consecuencias que modela:
//   - una linea que es un comando "::" valido es V2, y un "##[" dentro de sus
//     datos queda como dato (V2 gana);
//   - una linea que NO es un comando "::" y contiene "##[" en cualquier lugar
//     ("Motivo: recuento ##[error]X", "[COMPUERTA][ERROR] ... ##[error]X") ES un
//     comando del formato viejo.
//
// CONSERVADOR (cuenta de mas, nunca de menos):
//   - corta en CRLF, CR y LF;
//   - una linea que, tras recortar al inicio, empieza con "::" cuenta como
//     comando aunque no cierre el "::" del nombre o el nombre no este registrado
//     (si no cierra y trae "##[", se toma el formato viejo, como haria el runner);
//   - cualquier "##[" en una linea que no es V2 cuenta como comando, cierre o no
//     el "]" y este o no registrado el nombre;
//   - durante una pausa de ::stop-commands::, la reanuda cualquier linea que,
//     recortada, sea "::<token>::", o que parsee (V2 o viejo) con nombre igual al
//     token, sin distinguir mayusculas. Reanudar de mas solo agrega comandos.

function parsearV2(recortada) {
  const fin = recortada.indexOf("::", 2);
  if (fin < 0) return null;
  const info = recortada.slice(2, fin);
  return { formato: "v2", nombre: (info.split(/\s/)[0] ?? "").toLowerCase(), datos: recortada.slice(fin + 2) };
}

function parsearViejo(cruda) {
  const i = cruda.indexOf("##[");
  if (i < 0) return null;
  const cierre = cruda.indexOf("]", i + 3);
  const info = cierre < 0 ? cruda.slice(i + 3) : cruda.slice(i + 3, cierre);
  return {
    formato: "viejo",
    nombre: (info.split(/\s/)[0] ?? "").toLowerCase(),
    datos: cierre < 0 ? "" : cruda.slice(cierre + 1),
  };
}

// Devuelve null si la linea no es un comando, o { formato, nombre, datos }.
export function parsearLineaDeComando(cruda) {
  const recortada = cruda.trimStart();
  if (recortada.startsWith("::")) {
    const v2 = parsearV2(recortada);
    if (v2) return v2;
    const viejo = parsearViejo(cruda);
    if (viejo) return viejo;
    // Conservador: "::algo" sin cierre cuenta igual.
    return { formato: "v2", nombre: (recortada.slice(2).split(/[\s:]/)[0] ?? "").toLowerCase(), datos: "" };
  }
  return parsearViejo(cruda);
}

// Comandos que el runner ejecutaria sobre una salida completa.
export function comandosEfectivos(salida) {
  const comandos = [];
  const tokensDePausa = [];
  let pausa = null;
  for (const cruda of String(salida).split(/\r\n|\r|\n/)) {
    const cmd = parsearLineaDeComando(cruda);
    if (pausa !== null) {
      const token = pausa.toLowerCase();
      if (cruda.trim().toLowerCase() === `::${token}::` || (cmd && cmd.nombre === token)) pausa = null;
      continue;
    }
    if (!cmd) continue;
    if (cmd.nombre === "stop-commands") {
      pausa = cmd.datos;
      tokensDePausa.push(cmd.datos);
      continue;
    }
    comandos.push({ ...cmd, linea: cruda });
  }
  return { comandos, tokensDePausa, pausaAbierta: pausa !== null };
}
