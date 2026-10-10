# ednsQQor.github.io

Writeups de ciberseguridad, servidos como sitio estático con Jekyll en GitHub
Pages (build nativo al hacer `git push`, sin workflows de Actions).

Vive en: **https://ednsqqor.github.io**

## Estructura

```
_machines/          -> un .md por máquina suelta (HTB, etc.)
_engagements/        -> un .md por engagement/lab multi-máquina
assets/machines/<slug>/      -> imágenes de cada máquina
assets/engagements/<slug>/   -> imágenes de cada engagement
_layouts/, _includes/        -> plantillas
assets/css/style.css         -> todo el theme (colores en :root)
assets/js/main.js            -> TOC automática, botón "copiar", buscador de la home
scripts/convert_obsidian.py  -> conversor de embeds de Obsidian
index.html                   -> home (tarjetas + buscador)
```

Dos colecciones de Jekyll (`machines` y `engagements`), cada una con su propio
layout y su propia URL (`/machines/<slug>/`, `/engagements/<slug>/`). La home
lee ambas colecciones y pinta las tarjetas automáticamente — **no hay que
tocar la home nunca** para publicar contenido nuevo.

## Añadir una máquina nueva

1. Exporta tu writeup de Obsidian como siempre (con los `![[Pasted image ...]]`).
2. Conviértelo con el script (ver sección siguiente) indicando `--type machine`
   y un slug corto:

   ```powershell
   python scripts\convert_obsidian.py "C:\ruta\a\tu\writeup.md" --type machine --slug nombre-maquina
   ```

   Esto crea `_machines/nombre-maquina.md` con las imágenes ya copiadas a
   `assets/machines/nombre-maquina/` y los embeds reescritos a Markdown estándar.

3. Abre `_machines/nombre-maquina.md` y rellena el front-matter que el script
   deja con `TODO`:

   ```yaml
   ---
   title: "Nombre de la máquina"
   date: 2026-09-26
   os: Linux          # Linux | Windows
   difficulty: Medium # Easy | Medium | Hard
   tags: [tag1, tag2]
   summary: "Resumen de 1-2 frases para la tarjeta de la home."
   platform: HTB
   ---
   ```

4. `git add`, `git commit`, `git push` a `main`. GitHub Pages reconstruye el
   sitio solo; en 1-2 minutos está publicado.

No hay que editar la home, ni un índice, ni un `_data`: en cuanto el archivo
está en `_machines/` con su front-matter, aparece en la tarjeta automáticamente.

## Añadir un engagement nuevo (varias máquinas, con pivoting)

Un engagement es **una sola página** con una sección `##` por cada máquina —
así el relato del pivoting fluye de forma natural (de host en host) y el
índice de tabla de contenidos (automático) separa cada sección sin que haga
falta gestionar sub-páginas, navegación entre ellas ni un índice propio por
máquina. Es la opción más simple que cubre "resumen + diagrama de hosts +
flujo + detalle por máquina" sin añadir otra colección anidada.

1. Convierte el informe igual que una máquina, pero con `--type engagement`:

   ```powershell
   python scripts\convert_obsidian.py "C:\ruta\a\tu\engagement.md" --type engagement --slug nombre-lab
   ```

2. Rellena el front-matter, incluyendo la lista de hosts (se renderiza como
   tarjetas de resumen arriba de la página, antes del contenido):

   ```yaml
   ---
   title: "Nombre del engagement"
   date: 2026-09-26
   summary: "Resumen del escenario para la tarjeta de la home."
   hosts:
     - name: DC01
       os: Windows
       role: Domain Controller
       ip: 10.10.10.1
     - name: WEB01
       os: Linux
       role: Pivot / web server
       ip: 10.10.10.2
   ---
   ```

3. Estructura el cuerpo con un `##` por máquina (controla el orden en que
   aparecen en la tabla de contenidos automática) y escribe el flujo de
   pivoting como texto normal entre secciones:

   ```markdown
   ## Flujo general

   Cómo se salta de un host a otro, en 3-4 frases.

   ## DC01 — Domain Controller

   ... contenido de esa máquina ...

   ## WEB01 — Pivot

   ... contenido de esa máquina ...
   ```

4. `git add`, `git commit`, `git push`.

## Conversor de Obsidian (`scripts/convert_obsidian.py`)

Los writeups de Obsidian usan `![[Pasted image 2026....png]]`, que Jekyll no
entiende. El script:

- Busca todos los `![[...]]` del `.md`.
- Localiza cada imagen (busca recursivamente en la carpeta del `.md`, o en la
  carpeta que le indiques con `--images-dir`).
- Copia cada imagen a `assets/<machines|engagements>/<slug>/`, normalizando el
  nombre (sin espacios, en minúsculas) para que funcione como URL.
- Reescribe el embed a `![](ruta)` estándar (o a `<img width="...">` si en
  Obsidian usabas `![[imagen.png|300]]` para controlar el ancho).
- Si el `.md` no tenía front-matter, añade una plantilla con los campos a
  rellenar (`TODO`).
- Avisa si alguna imagen referenciada no se encontró (no se toca el embed en
  ese caso, para no perder la referencia).

Uso:

```powershell
python scripts\convert_obsidian.py RUTA\AL\WRITEUP.md --type machine --slug mi-maquina
python scripts\convert_obsidian.py RUTA\AL\WRITEUP.md --type engagement --slug mi-lab --images-dir "RUTA\A\Imagenes"

# Previsualizar sin escribir nada todavía:
python scripts\convert_obsidian.py RUTA\AL\WRITEUP.md --type machine --slug mi-maquina --dry-run
```

Requiere Python 3.10+ (sin dependencias externas).

### Nota: antivirus y PoCs de exploits

Si tu writeup incluye payloads tipo reverse shell, exploits en Python, etc.,
Windows Defender puede detectarlos como "trojan" (falso positivo sobre el
propio texto del writeup) y poner el archivo en cuarentena en cuanto se
escribe en disco. Si ves que `_machines/*.md` desaparece solo a los pocos
segundos de crearlo, añade exclusiones en Windows Security:

**Antivirus y protección contra amenazas → Administrar configuración →
Exclusiones → Agregar una exclusión → Carpeta**, y excluye la carpeta del
repo (y la carpeta donde guardas los writeups originales de Obsidian).

## Previsualizar en local

Necesitas Ruby + Bundler. En Windows:

1. Instala [RubyInstaller](https://rubyinstaller.org/) (versión con DevKit).
2. En una terminal nueva:

   ```powershell
   gem install bundler
   bundle install
   bundle exec jekyll serve
   ```

3. Abre `http://localhost:4000`. `jekyll serve` recarga solo al guardar
   cambios en la mayoría de archivos (si cambias `_config.yml`, reinícialo).

## Desplegar

No hay build step propio: GitHub Pages detecta el `Gemfile`/Jekyll y
construye el sitio automáticamente en cada push a `main`. Desplegar es:

```powershell
git add .
git commit -m "Nueva máquina: ..."
git push
```

En 1-2 minutos el cambio está en https://ednsqqor.github.io. Puedes ver el
estado del build en la pestaña **Actions** del repo (GitHub Pages lo gestiona
internamente aunque no haya workflows definidos por nosotros) o en
**Settings → Pages**.

## Personalizar el estilo

Todos los colores están en `:root` al principio de `assets/css/style.css`
(fondo, texto, acentos, colores de dificultad/SO). Cambiar la paleta es tocar
solo esas variables, no hay que buscar colores sueltos por el resto del CSS.
