# ednsQQor.github.io

Página personal donde publico mis writeups de ciberseguridad: máquinas
sueltas (HTB y similares) y engagements/labs multi-máquina con pivoting
entre hosts.

🔗 **https://ednsqqor.github.io**

> El sitio (plantillas, estilos y el script de conversión) está construido con ayuda de IA (Claude). Los writeups son propios.

## Writeups bloqueados (máquina aún no retirada)

Una máquina en `_machines/` puede llevar en el front-matter:

```yaml
status: active        # o "retired" (o simplemente no poner el campo = retired)
unlock_date: 2026-12-01   # opcional, solo informativo
```

- **`retired`** (o sin `status`): se publica normal, contenido visible, badge "RETIRED".
- **`active`**: en la home sale una tarjeta con nombre, SO, dificultad, badge "ACTIVE" y
  un **countdown en vivo** hasta `unlock_date` (si lo pones). La página de la máquina
  (`/machines/slug/`) muestra ese mismo aviso + countdown. El `summary`, los `tags` y el
  cuerpo del writeup **no se imprimen en ningún HTML** mientras `status: active`.

**⚠️ Regla crítica — este repo es público.** Que el sitio no *muestre* el contenido no
significa que esté oculto: cualquier archivo que subas a `_machines/` es visible en
GitHub (`github.com/ednsQQor/ednsQQor.github.io/blob/main/...`) aunque Jekyll no lo
renderice. Por eso, mientras una máquina esté `active`:

- Sube el archivo **solo con el front-matter** (título, SO, dificultad, `status: active`,
  `unlock_date` si lo sabes) y el cuerpo **vacío**. Nada de pasos, comandos, capturas ni
  flags reales todavía.
- Guarda el writeup real donde quieras mientras tanto (tu Obsidian, un sitio local, lo
  que sea) — simplemente no lo subas a este repo hasta que la máquina se retire.

Cuando se retire:

1. Convierte el writeup real con el script de siempre (`scripts/convert_obsidian.py`),
   apuntando al mismo `slug` que ya existe en `_machines/`.
2. Cambia `status: active` a `status: retired` (o quita el campo).
3. `git add`, `git commit`, `git push`. Ahora sí se publica con todo el contenido.

## Pendiente de rellenar

Las secciones **03 — ABOUT** y **04 — CONNECT** de `index.html` tienen placeholders
`TODO`: bio, áreas de foco, certificaciones, LinkedIn y email. Edita directamente ese
archivo para sustituirlos por tu contenido real.

## Licencia

MIT — ver [LICENSE](LICENSE).
