# Kotex en Salcobrand | Desbloquea tu caja (WebAR + NFC)

Experiencia web de realidad aumentada para celulares. La clienta toca el sticker NFC de la góndola, se abre la página, apunta la cámara y juega **una sola vez**: 5 rondas tocando la pantalla cuando una luz llega a la zona brillante alrededor de la caja Kotex en 3D. **Mientras más puntaje, más probabilidad de ganar.** Al terminar recibe un **código único por jugada** con su **hora exacta**, registra nombre y celular, y todo queda en una planilla lista para el sorteo.

```
kotex-ra/
├── index.html              Experiencia completa (cámara + caja 3D + juego + registro)
└── apps-script/
    ├── Code.gs             Backend: guarda jugadas en Google Sheets y hace el sorteo ponderado
    └── appsscript.json     Manifiesto del script
```

## Reglas del juego (se muestran antes de jugar)

1. **Solo se puede jugar 1 vez.** Está escrito en la pantalla inicial y el botón dice "Entendido, jugar mi única vez".
2. **Más puntaje, más probabilidad de ganar.** Cada punto es un boleto en el sorteo.

**Puntaje:** son 5 rondas de hasta 100 puntos. En cada una la luz recorre el aro y hay que tocar cuando pasa por la zona brillante: 100 puntos en el centro, bajando hasta 20 en el borde y 0 si fallas o no tocas en 7 segundos. Máximo 500 puntos. La dificultad sube por ronda (la zona se achica y la luz acelera con variaciones de velocidad).

**Sorteo ponderado:** una participante con 400 puntos tiene 400 boletos y otra con 100 tiene 100, por lo que la primera tiene 4 veces más probabilidad. Todas las que registran sus datos participan (mínimo 1 boleto), pero el puntaje inclina el resultado. Esto se probó simulando 60.000 sorteos: las frecuencias coinciden con las proporciones esperadas.

**Cómo se garantiza "1 sola vez":**
- En el celular: la jugada queda bloqueada desde que se toca "Entendido". Si cierra o recarga la página a mitad de juego, la jugada se cierra con los puntos acumulados y no se puede reiniciar. Al volver a abrir el link solo ve su resultado.
- En el servidor: 1 jugada por dispositivo y 1 participación válida por celular en toda la campaña (las repetidas quedan como `DUPLICADA` y no entran al sorteo; vale la primera que se registró).

## Cómo se conecta con Excel

GitHub Pages solo sirve archivos estáticos, así que no puede escribir un `.xlsx` directamente. La solución es una **planilla de Google Sheets** que recibe cada jugada en tiempo real por una URL de Apps Script. Desde ahí se descarga como Excel: *Archivo > Descargar > Microsoft Excel (.xlsx)*.

Columnas de la hoja `Jugadas`: Código, Fecha y hora (Chile), Timestamp UTC, Hora del celular, Tienda, Góndola, Dispositivo, Nombre, Teléfono, Opt-in, Estado, Registrado en, User agent, Campaña y **Puntaje** (columna O).

Estados: `SIN_REGISTRO` (jugó pero no dejó datos), `VALIDA` (participa en el sorteo), `DUPLICADA` (celular ya registrado; no entra al sorteo).

## Puesta en marcha

### 1. Planilla y backend
1. Crea una planilla en Google Sheets (por ejemplo "Kotex RA Sorteo").
2. *Extensiones > Apps Script*. Pega el contenido de `apps-script/Code.gs`.
3. En *Configuración del proyecto* activa "Mostrar archivo de manifiesto" y reemplaza `appsscript.json` por el de este repo.
4. Ejecuta `setup` una vez y acepta los permisos. Crea las hojas `Jugadas`, `Sorteo` y `Config`.
5. *Implementar > Nueva implementación > Aplicación web*: ejecutar como **tú**, acceso **Cualquier persona**. Copia la URL que termina en `/exec`.

> Cada vez que cambies `Code.gs` debes crear una **nueva versión** de la implementación para que se apliquen los cambios. Si ya tenías una versión anterior en uso, vuelve a ejecutar `setup` para agregar la columna Puntaje.

6. **Verifica la conexión** de dos formas:
   - En la planilla, menú **Kotex > Probar conexión**: escribe una fila de prueba, la borra y avisa.
   - Abre la URL `/exec` en el navegador: debe responder `{"ok":true,"service":"kotex-ra","sheet":"Jugadas","rows":0}`.

### 2. Frontend en GitHub Pages
1. Sube `index.html` al repo (reemplaza el anterior).
2. En `index.html`, bloque `CONFIG`, pega la URL en `ENDPOINT`. Con `ENDPOINT` vacío corre en **modo demo** (guarda en el celular; ideal para probar el juego).
3. *Settings > Pages > Deploy from a branch > main / root*.
4. Prueba abriendo `https://USUARIO.github.io/REPO/?t=SALCO-001&g=G12&debug=1` desde un celular. El aviso `DEBUG` indica si está conectada a Google Sheets o en modo demo. Quita `&debug=1` en los stickers definitivos.
5. En modo demo, para volver a probar abre la página con `?reset=1`. Esa opción se desactiva sola cuando `ENDPOINT` tiene la URL real.

### 3. Stickers NFC
- Usa etiquetas **NTAG213/215** y una app como *NFC Tools* para grabar una URL (registro NDEF) **distinta por tienda y góndola**:
  `https://USUARIO.github.io/REPO/?t=SALCO-001&g=G12`
  `t` = código de tienda, `g` = código de góndola. Quedan guardados en cada jugada.
- Imprime un **QR con la misma URL** junto al sticker como respaldo para celulares sin NFC.
- iPhone (XS o superior) lee NFC sin app; en Android debe estar activado.

## Cómo se hace el sorteo
1. (Opcional) En la hoja `Config`, celdas `B1` y `B2`, indica desde y hasta qué fecha y hora se consideran jugadas.
2. Menú **Kotex > Sortear ganadoras (por puntaje)**, ingresa cuántas ganadoras y suplentes.
3. El resultado queda en la hoja `Sorteo` con fecha del sorteo, puesto, código, nombre, celular, tienda, hora de la jugada y puntaje. Solo participan filas con estado `VALIDA`.

## Ajustes (bloque `CONFIG` de index.html)
| Parámetro | Efecto |
|---|---|
| `ROUNDS`, `MAX_PER_ROUND` | Rondas y puntos máximos por ronda. El máximo total debe coincidir con `SCORE_MAX` en `Code.gs` (hoy 5 x 100 = 500) |
| `ZONES` | Semiancho de la zona brillante por ronda (radianes). Menor = más difícil |
| `SPEEDS`, `WOBBLE` | Velocidad de la luz por ronda y variación de velocidad |
| `ROUND_TIMEOUT` | Segundos máximos por ronda |
| `MODEL_URL` | Opcional: URL de un modelo `.glb` real de la caja. Reemplaza al modelo incluido |
| `COLORS`, `DRAW_TEXT`, `BASES_URL` | Paleta, texto final y enlace a las bases |

## La caja 3D
El modelo incluido se arma por código a partir del diseño real: cajón inferior con cámara y foto, bandeja con CD, toallas Kotex (rosada y nocturna) y stickers, tapa con espejo, ampolletas y banda de colores. Al empezar el juego la caja se cierra y al terminar se abre con las ampolletas encendidas. Es una aproximación fiel pero no un escaneo: para máxima fidelidad pide a un artista 3D un `.glb` liviano (menos de 3 MB) y pon su URL en `MODEL_URL`.

## Limitaciones a tener en cuenta
- **El puntaje lo calcula el celular.** El servidor valida que esté entre 0 y 500, pero una persona técnica podría enviar un puntaje inflado. Para premios de alto valor conviene sumar verificación (reCAPTCHA, o registrar los instantes de cada toque y validarlos en servidor) o un backend propio.
- La URL del backend es pública. Cuotas de Google Apps Script: suficientes para un piloto; para campañas masivas conviene un backend dedicado.
- Quien borra los datos del navegador o usa otro celular obtiene un dispositivo nuevo; el control definitivo es 1 participación válida por número de celular.
- La "RA" es de cámara con objeto 3D en pantalla y paralaje por giroscopio, sin anclaje a una superficie real. Si se quiere anclar la caja a un marcador impreso se puede migrar a MindAR o 8th Wall sin cambiar el juego ni el backend.
- Las bases legales del concurso deben reflejar el sorteo ponderado por puntaje y la regla de una sola jugada, y el consentimiento de datos personales debe revisarse con el área legal del cliente.
