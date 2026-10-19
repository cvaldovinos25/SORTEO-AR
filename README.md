# Kotex en Salcobrand | Desbloquea tu caja (WebAR + NFC)

Experiencia web de realidad aumentada para celulares. La clienta toca el sticker NFC de la góndola, se abre la página, apunta la cámara y juega un minireto de timing (acertar 2 de 3). Al ganar recibe un **código único por jugada** con su **hora exacta**, registra nombre y celular, y todo queda en una planilla lista para el sorteo.

```
kotex-ra/
├── index.html              Experiencia completa (cámara + 3D + juego + registro)
└── apps-script/
    ├── Code.gs             Backend: guarda jugadas en Google Sheets y sortea
    └── appsscript.json     Manifiesto del script
```

## Cómo se conecta con Excel

GitHub Pages solo sirve archivos estáticos, así que no puede escribir un `.xlsx` directamente. La solución es una **planilla de Google Sheets** que recibe cada jugada en tiempo real por una URL de Apps Script. Desde ahí se descarga como Excel cuando se necesite: *Archivo > Descargar > Microsoft Excel (.xlsx)*.

Columnas de la hoja `Jugadas`: Código, Fecha y hora (Chile), Timestamp UTC, Hora del celular, Tienda, Góndola, Dispositivo, Nombre, Teléfono, Opt-in, Estado, Registrado en, User agent, Campaña.

Estados: `SIN_REGISTRO` (jugó pero no dejó datos), `VALIDA` (participa en el sorteo), `DUPLICADA` (mismo celular el mismo día; no entra al sorteo).

## Puesta en marcha

### 1. Planilla y backend
1. Crea una planilla en Google Sheets (por ejemplo "Kotex RA Sorteo").
2. *Extensiones > Apps Script*. Pega el contenido de `apps-script/Code.gs`.
3. En *Configuración del proyecto* activa "Mostrar archivo de manifiesto" y reemplaza `appsscript.json` por el de este repo.
4. Ejecuta `setup` una vez y acepta los permisos. Crea las hojas `Jugadas`, `Sorteo` y `Config`.
5. *Implementar > Nueva implementación > Aplicación web*: ejecutar como **tú**, acceso **Cualquier persona**. Copia la URL que termina en `/exec`.

> Cada vez que cambies `Code.gs` debes crear una **nueva versión** de la implementación para que se apliquen los cambios.

### 2. Frontend en GitHub Pages
1. Crea un repo y sube `index.html` (y este README).
2. En `index.html`, bloque `CONFIG`, pega la URL en `ENDPOINT`. Con `ENDPOINT` vacío corre en **modo demo** (guarda en el celular, ideal para probar el juego).
3. *Settings > Pages > Deploy from a branch > main / root*. La URL queda `https://USUARIO.github.io/REPO/`.
4. Prueba abriendo `https://USUARIO.github.io/REPO/?t=SALCO-001&g=G12` desde un celular.

### 3. Stickers NFC
- Usa etiquetas **NTAG213/215** y una app como *NFC Tools* para grabar una URL (registro NDEF) **distinta por tienda y góndola**:
  `https://USUARIO.github.io/REPO/?t=SALCO-001&g=G12`
  `t` = código de tienda, `g` = código de góndola. Quedan guardados en cada jugada y permiten medir qué locales rinden mejor.
- Imprime un **QR con la misma URL** junto al sticker como respaldo para celulares sin NFC.
- iPhone (XS o superior) lee NFC sin app; en Android debe estar activado.

## Cómo se hace el sorteo
1. (Opcional) En la hoja `Config`, celdas `B1` y `B2`, indica desde y hasta qué fecha y hora se consideran jugadas.
2. Menú **Kotex > Sortear ganadoras**, ingresa cuántas ganadoras y suplentes.
3. El resultado queda en la hoja `Sorteo` con fecha del sorteo, puesto, código, nombre, celular, tienda y hora de la jugada. Solo participan filas con estado `VALIDA`.

## Ajustes de dificultad (bloque `CONFIG`)
| Parámetro | Efecto |
|---|---|
| `NEED` y `ROUNDS` | Aciertos requeridos (por defecto 2 de 3) |
| `SPEEDS` | Velocidad de la luz en cada ronda |
| `TOLERANCE` | Ancho de la zona brillante; bájalo para hacerlo más difícil |
| `BOX_TEXTURE` | URL de una imagen del packshot real para la cara frontal de la caja |
| `COLORS` | Paleta de la experiencia |
| `DRAW_TEXT`, `BASES_URL` | Texto final y enlace a las bases del concurso |

## Reglas anti abuso incluidas
- Código aleatorio de 8 caracteres (alfabeto sin I, O, 0, 1) verificado como único en el servidor.
- Una jugada ganadora por celular al día (en el equipo) y tope de 3 códigos por dispositivo al día (en el servidor).
- Un mismo número de celular solo cuenta una vez por día; los repetidos quedan como `DUPLICADA`.
- Si no hay señal en la farmacia, la jugada se guarda en el celular y se envía sola al volver la conexión. La hora oficial es siempre la del servidor.
- Los textos que llegan a la planilla se sanean para evitar fórmulas inyectadas.

## Limitaciones a tener en cuenta
- Es una página pública y estática: la URL del backend es visible. Para un concurso con premios de alto valor conviene sumar verificación (por ejemplo reCAPTCHA) o un backend propio con autenticación de sticker.
- La "RA" es de cámara con objeto 3D en pantalla y paralaje por giroscopio. Si se quiere anclar la caja a una superficie real o a un marcador impreso, se puede migrar a MindAR o 8th Wall sin cambiar el juego ni el backend.
- Las bases legales del concurso deben estar publicadas y el consentimiento de datos personales revisado con el área legal del cliente.
- Cuotas de Google Apps Script: suficientes para un piloto; para campañas masivas conviene un backend dedicado.
