# Copias listas para pegar en el panel de Supabase

Esta carpeta **no es el código fuente**. El original vive en `edge-functions/`
y es el que hay que editar. Esto son seis copias preparadas para el único
camino que funciona desde el editor del panel.

## Por qué existe

Las funciones originales importan con `../_compartido/wompi.ts`: suben un nivel
hasta una carpeta hermana. El CLI despliega toda la carpeta `functions/`, así
que ese `..` resuelve. El editor del panel despliega **una función y su propio
árbol de archivos**, y no hay nivel superior al que subir.

Aquí cada función lleva su propia copia de los cuatro archivos compartidos
dentro, y el import cambiado a `./_compartido/…`. Es lo único que cambia: los
`index.ts` son byte a byte idénticos a los originales salvo esas líneas, y los
archivos de `_compartido/` son copias exactas.

## Cómo usarla

Edge Functions → Deploy a new function → Via Editor. Para cada carpeta:

1. Nombre de la función = nombre exacto de la carpeta.
2. Pega el contenido de `index.ts`.
3. Añade cuatro archivos más, con estos nombres exactos:
   `_compartido/admins.ts`, `_compartido/http.ts`, `_compartido/supabase.ts`,
   `_compartido/wompi.ts`.

Las seis llevan los mismos cuatro archivos, aunque alguna no use todos. Es
deliberado: así el procedimiento es idéntico en las seis y no hay que recordar
cuál necesita cuál. Un archivo que no se importa no se carga.

**`wompi-webhook` necesita un paso extra:** entra a la función → Settings →
apaga *Verify JWT with legacy secret*. Wompi no manda ningún token de Supabase.
Y compruébalo cada vez que la actualices: hay un fallo abierto en Supabase por
el que ese interruptor se vuelve a encender solo al redesplegar.

## Lo que tienes que recordar

Si algún día tocas un archivo de `edge-functions/_compartido/`, este código
queda viejo en seis sitios a la vez. Regenera esta carpeta antes de volver a
pegar nada. Es el precio de desplegar sin el CLI.
