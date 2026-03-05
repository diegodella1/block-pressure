# PRD: BLOCK PRESSURE
**RoxomTV — Bitcoin Live Broadcast Visualization**
**Version:** 1.0
**Status:** Ready for execution

---

## 1. Visión del Producto

Una visualización a pantalla completa, **broadcast-only** (zero interacción del usuario), que muestra el estado del mempool de Bitcoin en tiempo real con estética de terminal financiero profesional estilo TradingView. El movimiento es constante e ininterrumpido — los datos de la red Bitcoin generan el show.

**Concepto central:** El mempool como un mercado de fees en vivo. Las transacciones compiten por entrar al próximo bloque igual que órdenes compitiendo por ejecutarse en un exchange. El espectador que nunca vio Bitcoin entiende la mecánica en 10 segundos.

**Principio de diseño:** Limpio, denso de información, siempre en movimiento. Nunca hay un momento muerto en pantalla. La red Bitcoin nunca duerme — la visualización tampoco.

**Uso:** Pantalla completa standalone. Broadcast loop infinito sin intervención humana.

**Resolución objetivo:** 1920x1080 primaria, 3840x2160 secundaria.

---

## 2. Fuente de Datos

### WebSocket Principal
```
wss://mempool.space/api/v1/ws
```

**Suscripción al conectar:**
```json
{ "action": "want", "data": ["live-2h-chart", "stats", "mempool-blocks"] }
```

**Datos por transacción individual:**
| Campo | Uso |
|---|---|
| `txid` | ID único |
| `value` (sats) | Tamaño en el order book, ticker tape |
| `feeRate` (sat/vB) | Posición en el order book |
| `firstSeen` | Antigüedad |
| `vsize` (vB) | Para calcular peso en el bloque |

**Datos globales (cada ~2s):**
| Campo | Uso |
|---|---|
| `mempool_count` | Métrica HUD |
| `mempool_size` (vB) | Nivel de llenado del bloque proyectado |
| `fee_histogram` | Distribución en el order book |
| `recommended_fees` | Lines de referencia en el order book |

**Eventos de bloque:**
| Campo | Uso |
|---|---|
| `height` | Número de bloque en HUD y evento |
| `tx_count` | Cantidad confirmada en el evento |
| `extras.reward` | Recompensa del minero |
| `timestamp` | Para calcular tiempo entre bloques |

### Reconexión automática
Backoff exponencial: 1s → 2s → 4s → 8s → 16s → 30s (máximo).
Durante desconexión: la visualización continúa con datos en memoria. El ticker tape sigue corriendo con las últimas txs recibidas. Indicador de estado cambia a rojo.

### Mock data (testing)
`CONFIG.USE_MOCK_DATA = true` genera un flujo sintético realista:
- 3–8 txs por segundo
- Distribución de fee rates: log-normal, media 35 sat/vB, σ=1.2
- Distribución de valores: 70% bajo 0.01 BTC, 25% 0.01–1 BTC, 4% 1–100 BTC, 1% >100 BTC
- Evento de bloque simulado cada 10 minutos (configurable)

---

## 3. Layout de Pantalla

La pantalla se divide en **cuatro zonas** con proporciones fijas:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ZONA A — HUD SUPERIOR                                    altura: 8% │
│  Bloque #892,441  •  Mempool: 3,241 txs  •  Fee: 38 sat/vB  •  ...  │
├──────────────────────────────────────┬──────────────────────────────┤
│                                      │                               │
│  ZONA B — AREA CHART (scroll)        │  ZONA C — ORDER BOOK         │
│  Flujo de transacciones entrando     │  Fee tiers en tiempo real    │
│  al mempool en tiempo real           │                               │
│                    altura: 72%       │           anchura: 28%        │
│                    anchura: 72%      │                               │
├──────────────────────────────────────┴──────────────────────────────┤
│  ZONA D — TICKER TAPE                                     altura: 8% │
│  ←←← txid  •  ₿0.847  •  180 sat/vB    txid  •  ₿0.003  •  22 s/vB│
├─────────────────────────────────────────────────────────────────────┤
│  ZONA A2 — HUD INFERIOR                                   altura: 8% │
│  ₿ MOVIÉNDOSE: 1,204.38    PRÓXIMO BLOQUE: ~8 min    [EVENT TOAST]  │
└─────────────────────────────────────────────────────────────────────┘
```

**Separadores entre zonas:** líneas de 1px, color `#1e2d3d` (azul oscuro sutil). No borders agresivos.

---

## 4. Zona A — HUD Superior

### Visual
- Fondo: `#0a1628` (azul muy oscuro, no negro puro)
- Texto: `Space Mono 400`, 15px, color `#8899aa`
- Valores numéricos: `Space Mono 700`, 15px, color `#e0e8f0`
- Separador entre items: `•` en `#2a3a4a`

### Contenido (izquierda a derecha)
```
BLOQUE #892,441    •    MEMPOOL 3,241 txs    •    FEE MED 38 sat/vB    •    HASHRATE 620 EH/s    •    TIEMPO DESDE BLOQUE 04:32
```

- **BLOQUE #:** número del último bloque minado. Al actualizarse: flash amarillo en el número, dura 1s.
- **MEMPOOL txs:** cantidad de txs pendientes. Actualización cada 2s, transición de conteo tipo odómetro (200ms).
- **FEE MED:** fee rate mediana del mempool. Cambia de color: azul (bajo) → ámbar (medio) → rojo (alto). Misma escala de colores que el order book.
- **HASHRATE:** hashrate actual de la red en EH/s.
- **TIEMPO DESDE BLOQUE:** timer en vivo MM:SS desde el último bloque. Cuando supera 15 minutos: color cambia a rojo y el número pulsa suavemente (escala 1.0 → 1.05 → 1.0 cada 2s).

---

## 5. Zona B — Area Chart (protagonista)

Este es el elemento visual dominante. Ocupa el 72% del ancho y el 72% de la altura total.

### Concepto
Un area chart scrolling continuo de derecha a izquierda. El eje X es tiempo (los últimos N minutos). El eje Y es el **volumen de BTC entrando al mempool** agregado por ventanas de 10 segundos. La visualización nunca se detiene — el tiempo corre siempre.

### Scrolling
- Velocidad: el eje X representa los últimos **20 minutos** de actividad.
- Cada segundo, el chart avanza 1/1200 del ancho total hacia la izquierda.
- Los datos más viejos desaparecen por el borde izquierdo.
- Los datos nuevos aparecen por el borde derecho.
- El movimiento es **continuo y suave** (no en steps). Usar interpolación entre puntos.

### Qué se visualiza (capas apiladas, area chart)

El area chart tiene **tres capas apiladas** (stacked area), de abajo hacia arriba:

**Capa 1 — Txs confirmadas en últimos bloques** (base, más oscura)
- Color: `#0d2137` (azul muy oscuro)
- Representa: el "piso" — actividad ya procesada

**Capa 2 — Txs en mempool, fee bajo (<20 sat/vB)**
- Color: gradiente `#1a4a7a` → `#1e5f9a` con transparencia 0.7
- Fill con gradiente vertical: más sólido abajo, transparente arriba

**Capa 3 — Txs en mempool, fee alto (≥20 sat/vB)**
- Color: gradiente `#f0a500` → `#ff6b00` con transparencia 0.8
- Esta es la "presión urgente" — visualmente activa, brillante

El resultado: cuando hay muchas txs urgentes, el área naranja domina. Cuando la red está tranquila, domina el azul. El espectador siente el ritmo de la red.

### Línea de precio del fee (overlay)

Sobre el area chart, una **línea fina** muestra el fee rate mínimo necesario para entrar al próximo bloque. Es la línea de corte.

- Color: `#00d4ff` (cyan brillante)
- Grosor: 1.5px
- Glow sutil: `0 0 6px #00d4ff80`
- Cuando sube rápido: la línea pulsa brevemente (glow se intensifica por 0.5s)

### Spikes de whale transactions

Cuando llega una tx con valor > 50 BTC:
- Un spike vertical aparece en el punto temporal exacto en el area chart
- El spike es una línea blanca delgada (1px) que sobresale del área por 40px
- En el tope del spike: un punto blanco de 4px con glow
- Dura 8 segundos en pantalla antes de desaparecer suavemente con el scroll

### Ejes y grilla

**Eje Y** (izquierda):
- 5 líneas horizontales de referencia
- Color: `#1e2d3d`, 1px
- Labels: valores en BTC (ej: "0.5 BTC", "1 BTC", "2 BTC")
- Fuente: `Space Mono 400`, 11px, color `#445566`
- Los labels se reescalan dinámicamente si el rango cambia mucho

**Eje X** (abajo del chart):
- Marcas de tiempo cada 5 minutos (ej: "-20m", "-15m", "-10m", "-5m", "AHORA")
- "AHORA" siempre fijo en el borde derecho, color `#e0e8f0`
- Las marcas anteriores se mueven con el scroll

### Línea vertical "AHORA"
En el borde derecho del area chart: línea vertical de 1px, color `#2a3a4a`. Marca el presente. Los datos nuevos siempre aparecen aquí.

### Título del chart
Esquina superior izquierda dentro del área del chart:
```
BTC ENTRANDO AL MEMPOOL  •  ventana 20 min
```
`Space Mono 400`, 11px, `#445566`. No cambia.

---

## 6. Zona C — Order Book

El panel derecho (28% del ancho). Este es el elemento más "financiero" de la pantalla. Funciona exactamente como el order book de un exchange, pero en lugar de precio vs. cantidad, es **fee rate vs. peso acumulado**.

### Concepto
Cada fila del order book es un **tier de fee rate**. Muestra cuántos vBytes de transacciones están esperando a ese fee rate. Las transacciones con fee más alto están arriba y serán confirmadas primero.

Una línea horizontal de corte indica cuántas txs entran en el próximo bloque (4MB de peso virtual = un bloque completo).

### Estructura visual

```
┌─────────────────────────────┐
│  ORDER BOOK  •  MEMPOOL     │  ← header
├─────────────────────────────┤
│  sat/vB    vBytes    BTC    │  ← column headers
├──────────────────── ← CORTE ┤  ← línea de corte del próximo bloque
│  300+      12,450   0.14   │  ← tier muy urgente (rojo)
│  200-299   8,230    0.09   │
│  150-199   15,600   0.18   │
│  100-149   24,100   0.28   │
│  80-99     31,200   0.35   │
│  60-79     42,800   0.48   │
│  50-59     38,900   0.43   │
│──────────────── ← CORTE ────│  ← aquí está el corte real
│  40-49     67,400   0.71   │  ← estos entran en este bloque
│  30-39     98,200   1.04   │
│  20-29     112,000  1.19   │
├─────────────────────────────┤
│  <20       340,000  3.21   │  ← aggregado: fee bajo (no entra)
└─────────────────────────────┘
```

### Comportamiento de las filas

Cada fila se actualiza en tiempo real cuando llegan nuevas txs:

- Cuando una tx nueva entra a un tier: el valor de vBytes **aumenta** con una animación de flash verde sutil en esa fila (la fila se ilumina brevemente, 300ms).
- Cuando se mina un bloque: las filas por encima de la línea de corte se vacían con una animación de "fill" sweep de izquierda a derecha (ver sección Eventos).

### Colores de los tiers (columna sat/vB)

Misma escala que el área chart y el HUD:
```
≥ 200 sat/vB  →  #ff3333  (rojo intenso)
100–199       →  #ff6b00  (naranja rojo)
60–99         →  #f0a500  (ámbar)
40–59         →  #c8b800  (amarillo)
20–39         →  #4a9eff  (azul claro)
10–19         →  #2a6aaa  (azul medio)
< 10          →  #1a3a6b  (azul oscuro)
```

Las filas del tier también tienen un fill de color sutil en toda la fila (opacity 0.15) del mismo color que el label, para reforzar la lectura.

### Barra de capacidad del bloque

A la derecha de las columnas: una barra vertical que muestra el llenado del próximo bloque.

```
│ █  │  ← 100% lleno = bloque listo
│ █  │
│ ▓  │  ← zona de corte actual (donde está la línea)
│    │
│    │
```

- Fondo: `#0d1f30`
- Fill: gradiente vertical, rojo arriba (urgente) → azul abajo (bajo fee)
- La barra sube en tiempo real con cada tx nueva
- Cuando llega al 100%: pulsa brevemente (el bloque está "lleno", pendiente de ser minado)
- Label arriba: "PRÓX. BLOQUE" con porcentaje de llenado

### Línea de corte

La línea horizontal que separa las txs que entran en el próximo bloque de las que no:
- 1px, color `#00d4ff` (mismo cyan que la línea en el area chart — consistencia visual)
- Label izquierdo: `MIN FEE: 38 sat/vB` (se actualiza con cada tx nueva)
- Glow: `0 0 8px #00d4ff60`
- La línea se mueve hacia arriba o abajo con cada tx nueva (animación suave, 200ms easing)

### Header del panel
```
MEMPOOL ORDER BOOK
```
`Space Mono 700`, 13px, `#8899aa`. Fondo `#0d1828`.

### Column headers
```
sat/vB          vBytes          BTC
```
`Space Mono 400`, 11px, `#445566`. Subrayado con línea de 1px `#1e2d3d`.

---

## 7. Zona D — Ticker Tape

Una franja horizontal en el tercio inferior. Transacciones individuales corren de derecha a izquierda de forma continua e ininterrumpida. Es el elemento de mayor movimiento de la pantalla — **nunca se detiene**.

### Visual
- Fondo: `#050d18` (casi negro, levemente más oscuro que el HUD)
- Altura: 8% del viewport
- Una sola línea de texto centrada verticalmente

### Formato de cada item

```
[TXID_CORTO]  ₿ 0.847  •  180 sat/vB  •  4m ago        [SEPARADOR]
```

- **TXID_CORTO:** primeros 8 y últimos 4 caracteres del txid, separados por `···`. Ej: `a3f8b291···4e2d`
- **₿ valor:** en BTC con 3–8 decimales según magnitud. Para valores ≥ 1 BTC: mostrar con 3 decimales. Para < 0.001 BTC: mostrar en sats con el sufijo "sats".
- **sat/vB:** fee rate con color según la escala de colores (misma que el order book)
- **tiempo:** `Xs ago` o `Xm ago`. Actualiza en tiempo real para cada item visible.
- **Separador entre txs:** `  ▸  ` en `#2a3a4a`

### Colores en el ticker

- Label fijo (`sat/vB`, `₿`): `#445566`
- Valor del fee rate: color de la escala de fees
- Valor en BTC/sats: `#e0e8f0`
- TXID: `#445566` (menos importante, no distrae)
- Whale tx (>50 BTC): toda la entrada en **blanco puro** con glow sutil. Visible instantáneamente.

### Velocidad de scroll
- Velocidad base: 80px/segundo (configurable)
- **La velocidad aumenta proporcionalmente con el fee rate mediano del mempool.** Si la red está en pánico (fee >200 sat/vB), el ticker va a 160px/segundo. Si está tranquila (<10 sat/vB), va a 50px/segundo.
- La transición de velocidad es gradual (30 segundos para duplicar/dividir la velocidad).

### Buffer de txs
Mantener un buffer de las últimas 500 txs recibidas. El ticker las muestra en loop si no hay datos nuevos. Cuando llegan txs nuevas, se insertan al final del buffer y las más viejas se descartan.

### Pausa durante evento de bloque
Durante la animación del evento de bloque minado (6 segundos): el ticker no se pausa pero **cambia el color de fondo** a un azul levemente más claro, indicando el estado especial. Las txs confirmadas que aparecen en el ticker se marcan con `✓` delante del txid.

---

## 8. Zona A2 — HUD Inferior

Misma estética que el HUD superior.

### Contenido
```
₿ EN MEMPOOL: 1,204.38        PRÓX. BLOQUE: ~8 min        [TOAST ZONE — derecha]
```

- **₿ EN MEMPOOL:** suma total de BTC en todas las txs del mempool. Actualiza cada 5s con animación de conteo.
- **PRÓX. BLOQUE:** estimación en minutos. Basado en el tiempo promedio de los últimos 6 bloques y el llenado actual del mempool. Formato: `~X min` o `MUY PRONTO` cuando está >90% lleno.
- **TOAST ZONE:** zona derecha (35% del ancho del HUD inferior) reservada para notificaciones de eventos. Ver sección Eventos.

---

## 9. Sistema de Eventos

Los eventos transforman la visualización pasiva en broadcast activo. Son los **momentos televisivos**.

### Evento 1: Nueva transacción whale (>50 BTC)

**Trigger:** tx con value > 5,000,000,000 sats (~50 BTC)

**Secuencia (duración: 5s):**
1. **0s:** La entrada de la tx en el ticker tape se resalta en blanco puro. El scroll del ticker se hace más lento por 2 segundos (50% de velocidad) para que el espectador la vea.
2. **0s:** En el area chart, aparece un spike blanco en el punto "AHORA".
3. **0.2s:** Toast aparece en la zona inferior derecha:
   ```
   ⚡ TX GRANDE
   ₿ 847.00  •  180 sat/vB
   ```
   Fondo: `#0a1628`. Borde izquierdo: 3px `#f0a500`. Texto blanco.
   Entrada: slide desde la derecha (300ms ease-out).
   Salida: fade-out a los 5s.
4. **0.2s:** La fila correspondiente en el order book hace flash intenso (opacity 0.6 → 0.1 en 400ms).
5. Para super whale (>100 BTC): además, un flash sutil de pantalla completa (opacity 0 → 0.08 → 0 en 0.3s, color blanco).

### Evento 2: Bloque minado ⭐

**Este es el evento principal. El latido de Bitcoin. Toda la pantalla lo celebra.**

**Trigger:** mensaje `block` del WebSocket.

**Secuencia completa (duración total: 7s):**

**Step 1 — Anuncio (0s):**
Toast grande centrado en la zona inferior, tamaño 2x el normal:
```
BLOQUE #892,441  MINADO
312 txs confirmadas  •  Recompensa: 3.125 BTC
```
Fondo: `#0d2137` con borde superior de 2px `#00d4ff`. Aparece con fade-in (300ms).

**Step 2 — Order book sweep (0.5s–2.5s):**
Las filas del order book por encima de la línea de corte se vacían en cascada de arriba hacia abajo. Cada fila hace una animación de "fill" de izquierda a derecha en color `#00d4ff` (cyan), luego el valor cae a 0 y la fila queda en gris oscuro momentáneamente. Velocidad: aproximadamente 8 filas por segundo.

Este es el equivalente visual de órdenes ejecutándose en un exchange. Es el momento más cinematográfico.

**Step 3 — Pulso en el area chart (2.5s):**
Una línea vertical cyan (`#00d4ff`) barre el area chart de derecha a izquierda en 0.5 segundos. Como un scanner. Deja un rastro que se desvanece.

**Step 4 — Reconfiguración del order book (3s–5s):**
Las filas que quedaron vacías se reorganizan. Las filas con fee bajo que no entraron suben y ahora se convierten en candidatos para el próximo bloque. La línea de corte se mueve hacia abajo suavemente (hay menos competencia). Animación: cada fila sube con easing, 200ms de delay escalonado.

**Step 5 — Reset y calma (5s–7s):**
La barra de capacidad del bloque hace una animación de vaciado (de lleno a casi vacío) y comienza a llenarse de nuevo con las txs restantes. El toast hace fade-out. La pantalla vuelve al estado normal.

**Step 6 — Actualización del HUD (7s):**
El número de bloque en el HUD superior hace flash amarillo. El timer "TIEMPO DESDE BLOQUE" resetea a 00:00.

### Evento 3: Mempool congestionado

**Trigger:** fee rate mediana > 100 sat/vB por más de 60 segundos.

**Visual (gradual, no abrupto):**
- El fondo del area chart adquiere un tinte rojo muy sutil (opacity 0.05, aumenta lentamente)
- Las filas superiores del order book (las rojas) hacen un pulso suave y continuo
- El ticker aumenta velocidad gradualmente
- El HUD superior cambia el label "FEE MED" a color rojo brillante
- No hay toast — el ambiente lo comunica

Persiste hasta que el fee mediano baje de 50 sat/vB.

### Evento 4: Red tranquila

**Trigger:** fee rate mediana < 5 sat/vB Y mempool < 2.000 txs.

**Visual:**
- El fondo del area chart tiene un tinte azul profundo muy sutil
- Las áreas naranjas del chart prácticamente desaparecen (solo azul)
- El ticker baja a 50px/segundo (se puede leer)
- Sensación de quietud — Bitcoin descansa

### Evento 5: Bloque lento (>20 minutos sin bloque)

**Trigger:** tiempo desde último bloque > 20 minutos.

**Visual:**
- El timer en el HUD superior pulsa en rojo
- La barra de capacidad del order book pulsa (hay mucha presión acumulada)
- El toast inferior: `⚠ BLOQUE TARDÍO — 23 MIN SIN CONFIRMAR`
- La barra del próximo bloque sube a 100% y hace pulso de "lleno" repetido

---

## 10. Estética y Diseño Visual

### Paleta de colores completa
```css
/* Fondos */
--bg-primary:      #05101f;   /* fondo general */
--bg-chart:        #070f1c;   /* fondo del area chart */
--bg-orderbook:    #060e1a;   /* fondo del order book */
--bg-ticker:       #050d18;   /* fondo del ticker tape */
--bg-hud:          #0a1628;   /* fondo de HUDs */
--bg-separator:    #1e2d3d;   /* líneas separadoras */

/* Texto */
--text-primary:    #e0e8f0;   /* valores importantes */
--text-secondary:  #8899aa;   /* labels */
--text-muted:      #445566;   /* texto de fondo */

/* Accents */
--accent-cyan:     #00d4ff;   /* línea de corte, scanner */
--accent-orange:   #f0a500;   /* Roxom brand, ámbar */
--accent-white:    #ffffff;   /* whale events, máxima urgencia */

/* Fee rate scale */
--fee-very-high:   #ff3333;
--fee-high:        #ff6b00;
--fee-medium-high: #f0a500;
--fee-medium:      #c8b800;
--fee-low-medium:  #4a9eff;
--fee-low:         #2a6aaa;
--fee-very-low:    #1a3a6b;

/* States */
--state-ok:        #00cc66;
--state-warn:      #f0a500;
--state-error:     #ff3333;
```

### Tipografía
```
Fuente única: Space Mono (Google Fonts)
Weights: 400 (regular), 700 (bold)

Uso:
- Labels HUD:      Space Mono 400, 14px, --text-secondary
- Valores HUD:     Space Mono 700, 14px, --text-primary
- Order book:      Space Mono 400, 13px
- Ticker tape:     Space Mono 400, 14px
- Ejes chart:      Space Mono 400, 11px, --text-muted
- Event toast:     Space Mono 700, 16px (título), 400 13px (detalle)
- Headers panel:   Space Mono 700, 12px, letter-spacing: 0.1em
```

Import:
```html
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
```

### Profundidad y atmósfera
- Sutil ruido de grain en el fondo general (canvas overlay de 1px puntos aleatorios, opacity 0.03). Da textura sin distracción. Se regenera cada 2 segundos para efecto de "film grain" sutil.
- Sombras internas en los paneles: `inset 0 0 40px rgba(0,0,0,0.5)` en los bordes.
- El area chart tiene un ligero vignette en los bordes (gradiente radial oscuro desde los bordes hacia el centro, opacity 0.3).

### Líneas de grilla
Todas las líneas de separación y grilla: `#1e2d3d`, 1px. Nunca más gruesas. La pantalla debe sentirse como un instrumento de precisión, no como una infografía.

---

## 11. Arquitectura Técnica

### Stack

```
Rendering:    HTML5 Canvas para el area chart y ticker tape
              DOM + CSS para el order book y HUDs
WebSocket:    Native WebSocket API
Animación:    requestAnimationFrame a 60fps
Framework:    Vanilla JS — sin dependencias externas
Fuentes:      Google Fonts (Space Mono)
```

**Sin frameworks, sin librerías.** El performance es crítico para broadcast. Una sola dependencia es aceptable: si se usa un charting library para el area chart, usar solo `uPlot` (la más liviana, <40KB).

### Estructura de archivos

```
/
├── index.html
├── app.js
│   ├── WebSocketManager
│   ├── MempoolState
│   ├── AreaChart          (canvas)
│   ├── OrderBook          (DOM)
│   ├── TickerTape         (canvas)
│   ├── HUDController      (DOM)
│   └── EventSystem
└── README.md
```

Todo en un único `index.html` self-contained es también aceptable.

### Canvas vs DOM

| Elemento | Técnica | Razón |
|---|---|---|
| Area chart | Canvas 2D | Scrolling continuo, muchos puntos, re-render constante |
| Ticker tape | Canvas 2D | Scroll pixel-perfect a velocidad variable |
| Order book | DOM (tabla) | Actualizaciones por celdas individuales, mejor para flash animations |
| HUDs | DOM | Texto estático que cambia, CSS transitions suficientes |
| Event toasts | DOM | CSS animations, fácil manejo |

### Loop principal

```javascript
function mainLoop(timestamp) {
  const delta = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  // Canvas updates
  areaChart.update(delta);
  areaChart.render();
  tickerTape.update(delta);
  tickerTape.render();

  // DOM updates (throttled, no en cada frame)
  if (timestamp - lastDOMUpdate > CONFIG.DOM_UPDATE_INTERVAL) {
    orderBook.update(mempoolState);
    hudController.update(mempoolState);
    lastDOMUpdate = timestamp;
  }

  requestAnimationFrame(mainLoop);
}
```

El order book y los HUDs se actualizan cada 250ms, no cada frame — suficientemente fluido sin abusar del DOM.

### Gestión de datos para el area chart

El area chart mantiene un buffer circular de los últimos 20 minutos, con resolución de 10 segundos:
```javascript
// 20 min × 6 buckets/min = 120 buckets
const CHART_BUCKETS = 120;
const BUCKET_DURATION = 10000; // ms

// Cada bucket:
{
  timestamp: number,
  totalValueBTC: number,    // para el eje Y
  feeHighValueBTC: number,  // para la capa naranja (fee ≥ 20)
  feeLowValueBTC: number,   // para la capa azul (fee < 20)
  confirmedValueBTC: number // para la capa base
}
```

Cuando llega una tx nueva: se agrega al bucket activo (el más reciente).
Cada 10 segundos: se cierra el bucket activo y se abre uno nuevo.

### Performance targets
- 60fps estable en hardware de broadcast moderno
- DOM updates a 250ms — no causa layout thrashing
- Canvas del area chart: re-render completo cada frame (el scroll lo requiere)
- Canvas del ticker: re-render completo cada frame
- Memory: no acumular objetos. Buffer circular para chart. Buffer fijo para ticker (500 txs máximo).

---

## 12. Configuración

```javascript
const CONFIG = {
  // Data source
  WS_URL: 'wss://mempool.space/api/v1/ws',
  USE_MOCK_DATA: false,
  RECONNECT_BASE_DELAY: 1000,
  RECONNECT_MAX_DELAY: 30000,

  // Area chart
  CHART_WINDOW_MINUTES: 20,
  CHART_BUCKET_SECONDS: 10,

  // Ticker tape
  TICKER_BASE_SPEED: 80,         // px/segundo
  TICKER_MAX_SPEED: 160,         // px/segundo (en pánico de fees)
  TICKER_BUFFER_SIZE: 500,

  // Order book
  ORDER_BOOK_TIERS: [
    { min: 300, max: Infinity, label: '300+' },
    { min: 200, max: 299, label: '200-299' },
    { min: 150, max: 199, label: '150-199' },
    { min: 100, max: 149, label: '100-149' },
    { min: 80,  max: 99,  label: '80-99'  },
    { min: 60,  max: 79,  label: '60-79'  },
    { min: 50,  max: 59,  label: '50-59'  },
    { min: 40,  max: 49,  label: '40-49'  },
    { min: 30,  max: 39,  label: '30-39'  },
    { min: 20,  max: 29,  label: '20-29'  },
    { min: 0,   max: 19,  label: '<20'    },
  ],
  BLOCK_CAPACITY_VBYTES: 4_000_000,

  // Events
  WHALE_THRESHOLD_SATS: 5_000_000_000,       // 50 BTC
  SUPER_WHALE_THRESHOLD_SATS: 10_000_000_000, // 100 BTC
  CONGESTION_FEE_THRESHOLD: 100,              // sat/vB
  SLOW_BLOCK_THRESHOLD_MINUTES: 20,

  // DOM updates
  DOM_UPDATE_INTERVAL: 250,                   // ms
  HUD_TOTAL_BTC_UPDATE_INTERVAL: 5000,

  // Toast
  TOAST_DURATION: 5000,
  TOAST_FADE_DURATION: 300,

  // Visual
  GRAIN_OPACITY: 0.03,
  GRAIN_REFRESH_INTERVAL: 2000,
};
```

---

## 13. Estados de la Aplicación

### CONNECTING
- Pantalla oscura
- Centro: texto `CONECTANDO A LA RED BITCOIN...` en Space Mono, pulsante
- No hay datos, no hay charts

### LOADING
- WebSocket conectado, llegando los primeros datos
- Los charts comienzan a construirse con los datos históricos del mempool
- El order book se llena rápidamente (bulk load de txs existentes)
- Duración: 2–4 segundos

### LIVE
- Estado normal. Todo en movimiento.

### DISCONNECTED
- Indicador de conexión en rojo
- La visualización sigue corriendo con los datos en memoria
- El ticker sigue en loop con las últimas txs
- El timer HUD sigue corriendo (aunque el bloque no se está actualizando)
- Texto sutil en el HUD: `RECONECTANDO...`
- No se interrumpe la experiencia visual

### ERROR
- Solo si el canvas no puede inicializar o hay un error crítico
- Pantalla oscura con:
  ```
  BITCOIN NETWORK UNAVAILABLE
  ```
  Space Mono 700, centrado, color `#445566`

---

## 14. Entregable Esperado

### Archivos
```
index.html (puede ser self-contained con todo incluido)
README.md  (instrucciones para correr localmente)
```

### Checklist de entrega
- [ ] Conecta al WebSocket de mempool.space y procesa datos en tiempo real
- [ ] Area chart scrollea continuamente de derecha a izquierda sin interrupciones
- [ ] Area chart tiene tres capas apiladas (confirmado / fee bajo / fee alto)
- [ ] Línea cyan de fee mínimo overlay en el area chart
- [ ] Spikes de whale txs visibles en el area chart
- [ ] Order book se actualiza en tiempo real con flash en filas afectadas
- [ ] Línea de corte del order book se mueve dinámicamente
- [ ] Barra de capacidad del próximo bloque funcional
- [ ] Ticker tape scrollea de derecha a izquierda de forma continua e ininterrumpida
- [ ] Velocidad del ticker varía con el fee rate del mempool
- [ ] Whale txs resaltadas en blanco en el ticker
- [ ] HUD superior: bloque, tx count, fee mediana, tiempo desde bloque
- [ ] HUD inferior: BTC total en mempool, estimación próximo bloque
- [ ] Evento de bloque minado: sweep del order book + scanner del chart + reconfiguración
- [ ] Evento whale: toast + spike + flash en order book
- [ ] Evento congestionado: tinte rojo ambiente
- [ ] Indicador de estado de conexión funcional
- [ ] Reconexión automática sin interrumpir la visualización
- [ ] 60fps estable
- [ ] Escala a 1920x1080 y 3840x2160
- [ ] `CONFIG` object al inicio para todos los ajustes
- [ ] Mock data mode funcional

---

## 15. Criterios de Calidad Visual (no negociables)

1. **El fondo es oscuro, nunca negro puro.** `#05101f` — profundidad sin ser agresivo.
2. **Space Mono únicamente.** Ninguna otra fuente en ningún elemento.
3. **El area chart nunca tiene un momento quieto.** El scroll es continuo aunque no lleguen datos nuevos.
4. **El ticker nunca se detiene.** Ni por un frame.
5. **El evento de bloque es el momento más importante.** El sweep del order book tiene que sentirse como una ejecución de órdenes real — preciso, rápido, satisfactorio.
6. **Todos los colores siguen la escala de fees.** Consistencia absoluta entre el area chart, el order book, el ticker y los HUDs.
7. **Legibilidad broadcast:** todo texto visible a 2 metros de un monitor 55" a 1080p.
8. **Sin animaciones innecesarias.** Solo se anima lo que comunica algo. El movimiento tiene significado.
9. **Los HUDs son instrumentos, no decoración.** Información densa pero nunca confusa.
10. **La pantalla en un día tranquilo se ve diferente a un día de pánico.** El color y el ritmo general del sistema debe cambiar de forma perceptible según el estado de la red.

---

*Prepared for RoxomTV — Bitcoin Media & Broadcast Network*
*diegodella.ar*
