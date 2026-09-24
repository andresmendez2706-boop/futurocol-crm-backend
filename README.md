# Futurocol Academy CRM — backend real

Migración del CRM de Futurocol Academy (antes una sola página HTML con `localStorage`) a una
aplicación multiusuario con **API**, **PostgreSQL** y **autenticación real**. Conserva la lógica de
negocio, la navegación y el diseño del CRM original.

| Pieza | Tecnología |
|---|---|
| API | Node.js 20+ · Express 5 |
| Base de datos | PostgreSQL 14+ (probado con 16) |
| Autenticación | Correo + contraseña, **bcrypt** (12 rondas), sesión JWT en cookie `httpOnly` |
| Tiempo real | Server-Sent Events + `LISTEN/NOTIFY` de PostgreSQL (funciona con varias instancias) |
| Interfaz | HTML/CSS/JS sin framework ni compilación (`public/`) |
| Pruebas | `node:test` + supertest contra una base PostgreSQL real |

## Puesta en marcha

### Opción A: Docker (lo más rápido)

```bash
JWT_SECRET=$(openssl rand -hex 32) ADMIN_EMAIL=tu@correo.com ADMIN_PASSWORD='UnaClaveSegura123' \
  docker compose up --build
```

Abre http://localhost:3000 e inicia sesión con ese correo y contraseña.

### Opción B: Node + PostgreSQL propios

```bash
npm install
cp .env.example .env          # completa DATABASE_URL y JWT_SECRET
npm run migrate               # crea las tablas
npm run create-admin -- --email tu@correo.com --password 'UnaClaveSegura123' --name "Tu Nombre"
npm start                     # http://localhost:3000
```

Las migraciones también se aplican solas al arrancar el servidor.

### Migrar los datos del CRM anterior

1. En el CRM anterior: **Auditoría → Descargar copia de seguridad** (archivo `.json`).
2. Impórtalo tal cual, de una de estas dos formas:
   - Desde la interfaz: **Auditoría → Cargar copia (.json) → Fusionar**.
   - Desde la terminal: `npm run import-backup -- ruta/backup.json` (opciones: `--mode merge|replace`, `--as correo-del-admin`).

Qué hace la importación:

- Conserva los IDs originales, el `stageHistory` de cada negocio, la bitácora de cada contacto y toda la auditoría.
- **Contraseñas:** el CRM anterior guardaba `btoa(contraseña)`. Se decodifican y se guardan de nuevo con bcrypt, así que cada persona entra con **la misma contraseña de siempre**, pero ahora con un hash seguro.
- Los campos que no tienen columna propia se guardan en la columna `extra` de cada tabla, para no perder nada.
- Si un registro apunta a un usuario que no existe, queda a nombre de quien importa (nunca queda huérfano). Si un negocio usa una etapa que no existe, la etapa se agrega al catálogo.
- Los usuarios sin correo válido reciben uno provisional `…@sin-correo.invalid`, y la pantalla Usuarios los marca con "actualizar".
- Importar dos veces el mismo archivo no duplica nada.
- El importador acepta varios formatos: colecciones en la raíz del JSON, dentro de `data`, o como strings JSON al estilo `localStorage` (`crm_contacts: "[...]"`). **Pruébalo primero con una copia real en un entorno de prueba**, porque no tuve acceso a un backup del CRM original para validar los nombres exactos de sus campos.

## Pruebas

```bash
createdb futurocol_crm_test    # o define TEST_DATABASE_URL
npm test
```

Hay 42 pruebas que cubren autenticación, permisos, reglas de etapas, comisiones, automatizaciones,
configuración e importación y restauración de copias. GitHub Actions las corre en cada push
(`.github/workflows/ci.yml`).

## Cómo quedó cada punto de la especificación

### Permisos (validados en el servidor)
- `canManage(record) = admin || record.assignedTo === usuario` se aplica en cada ruta que modifica datos (`src/permissions.js`). Ocultar botones en la interfaz es solo un complemento.
- El asesor solo recibe sus propios contactos, negocios y tareas. Lo que crea queda a su nombre y no puede asignarlo a otra persona.
- Solo el admin elimina contactos, negocios, empresas y usuarios. También es el único con acceso a Usuarios, Auditoría, Reportes, Configuración, Código fuente, CSV y copias de seguridad; si otro usuario lo intenta, la API responde `403`.
- Tareas: el admin las ve todas, pero las de otros usuarios en **solo lectura**. Cada persona modifica solo las suyas.
- Al **eliminar un usuario**, sus empresas, contactos, negocios y tareas pasan a quien lo elimina, en una sola transacción. La llave foránea `ON DELETE RESTRICT` impide a nivel de base de datos que un registro quede sin dueño.

### Negocios y etapas
- Al pasar un negocio a **perdido** se exige un motivo (`422 LOSS_REASON_REQUIRED`), salvo que ya tenga uno. La base de datos también lo exige con un `CHECK`.
- Al pasar a **ganado** o **perdido**, `closeDate` toma la fecha de hoy (zona `America/Bogota`).
- Cada cambio de etapa agrega `{stage, from, at, by}` al `stageHistory` y deja registro en la auditoría ("cambio de etapa", "cierre ganado" o "cierre perdido"). El detalle del negocio muestra el **Historial de etapas**.
- En **Configuración** se pueden agregar, renombrar, reordenar y eliminar etapas. Las protegidas (aplazado, ganado, perdido) solo se pueden renombrar y siempre quedan al final. Para eliminar una etapa que tiene negocios, hay que elegir a qué etapa moverlos.
- Si un negocio no tiene probabilidad propia, usa la de su etapa (10/20/30/40/50/70/25/100/0, editable por etapa).

### Comisiones (`src/services/rules.js → computeCommissions`)
- **Asesor:** su tasa individual × lo que facturó él mismo (negocios ganados) en el período.
- **Admin (gerencia):** su tasa × la facturación **total** de la academia, calculada mes a mes. No depende de sus propias ventas.
- La tasa es individual (`users.commission_rate`): cambiar la de una persona no afecta a nadie más. Quien no tiene tasa propia usa la de su rol, definida en Configuración (admin, asesor y escalas sugeridas).
- Se muestran en cuadros **separados**, nunca sumados. El filtro de período (mes, año o general) es el mismo en Panel, Negocios, Reportes y Embudo, y se guarda en las preferencias del usuario.

### Automatizaciones (`src/services/automations.js`, cada 15 min en el servidor)
- Lead con 2 o más días en la primera etapa sin actividad → tarea "Contactar lead".
- Negocio con 48 h o más en "Propuesta enviada" → tarea de seguimiento.
- Cada disparo queda en `automation_log`, así que la misma tarea no se crea dos veces aunque alguien la borre. Un bloqueo en PostgreSQL evita que dos servidores la ejecuten al mismo tiempo.
- Semáforo de tareas (se calcula al mostrarlas): rojo = vencida, amarillo = vence hoy o mañana, verde = completada o con más plazo.

### Auditoría
- Se registra sola en: creación, edición y eliminación de contactos, empresas, negocios, tareas y usuarios; cambios de etapa, de responsable, de rol y de comisión; configuración; inicio de sesión; importaciones, exportaciones y copias de seguridad; y automatizaciones.
- Es de **solo lectura**: la API no tiene ninguna ruta para editarla o borrarla, y un *trigger* de PostgreSQL rechaza cualquier `UPDATE` o `DELETE` sobre `audit_log`. Restaurar una copia tampoco la borra; solo le agrega registros.

### Multiusuario en tiempo real
Cada cambio publica un aviso por `pg_notify`. Los navegadores conectados lo reciben por
`/api/events` y vuelven a cargar **sus** datos (siempre filtrados por permisos). Si un asesor crea un
contacto, el admin lo ve en uno o dos segundos sin recargar la página. El indicador "En línea" de la
barra lateral muestra el estado de la conexión.

### Seguridad
- Contraseñas con bcrypt. Mínimo 8 caracteres para cuentas nuevas y cambios de contraseña.
- Cookie `httpOnly` y `SameSite=Lax` (y `Secure` en producción). Toda petición que modifica datos debe traer la cabecera `X-Requested-With` como protección CSRF.
- Máximo 10 intentos **fallidos** de inicio de sesión cada 15 min por IP y cuenta, así un equipo que comparte IP no se bloquea entre sí.
- Al cambiar la contraseña se cierran las demás sesiones de ese usuario.
- Cabeceras de seguridad con `helmet` (CSP sin scripts en línea). La interfaz escapa todo el contenido que muestra.

### Diseño
Se conservan la paleta (#4527A0 y #1AA6E8), el degradado a 160° en la barra lateral y el login,
el logo en un círculo blanco con sombra sobre el nombre, el bloque de usuario, el buscador global y el
menú en el mismo orden. Los diálogos de confirmación, aviso y motivo de pérdida son **modales propios**:
no hay ningún `window.confirm/alert/prompt`. El semáforo es un punto de color. El kanban tiene scroll
propio por columna y se desplaza solo hacia los lados al arrastrar una tarjeta cerca del borde.

> **Logo:** `public/img/logo.png` (símbolo, se muestra en el círculo), `public/img/favicon.png` (pestaña del navegador) y `public/img/logo-completo.png` (logo con nombre).

## Decisiones tomadas donde la especificación no era explícita

- **"Leads por etapa"**: un contacto está en la etapa de su negocio más reciente. Si no tiene negocios, está en la primera etapa (Lead nuevo).
- **Panel del asesor**: muestra "Mi comisión". No muestra la comisión del admin ni el pipeline ponderado, porque revelarían la facturación total.
- **Duplicados por teléfono**: con 10 dígitos o más se comparan los últimos 10, así `+57 300…` y `300…` cuentan como el mismo número. Si el duplicado es de otro asesor, solo se muestra que existe y quién lo tiene.
- **Eliminar un contacto** borra sus tareas; sus negocios se conservan sin contacto, para no alterar la facturación histórica. **Eliminar una empresa** deja a sus contactos sin empresa.
- **Mensajes**: cada usuario ve solo sus conversaciones. Si se elimina un usuario, sus mensajes se conservan como historial.
- **Recuperar contraseña**: no hay envío de correos. El admin restablece la contraseña desde Usuarios. Si luego se configura un servidor SMTP, se puede agregar el flujo de "olvidé mi contraseña".

## Estructura

```
db/migrations/        SQL del esquema (se aplica solo al iniciar)
src/
  server.js           arranque (migraciones, tiempo real, automatizaciones)
  app.js              Express: seguridad, rutas, manejo de errores
  auth.js             bcrypt, JWT, middleware de sesión y CSRF
  permissions.js      canManage y alcance por rol
  realtime.js         SSE + LISTEN/NOTIFY
  routes/             auth, users, companies, contacts, deals, tasks, messages, settings, admin, core
  services/           rules (comisiones, semáforo), metrics, automations, backup, stageChange, settings
  cli/                migrate, create-admin, import-backup
public/               interfaz (index.html, css/, js/, img/)
test/                 pruebas de la API contra PostgreSQL
```

## API (resumen)

| Método | Ruta | Quién |
|---|---|---|
| POST | `/api/auth/login` · `/api/auth/logout` · `/api/auth/password` | todos |
| GET | `/api/bootstrap` (todo lo visible para el usuario) · `/api/events` (SSE) | todos |
| GET | `/api/stats/dashboard?type=month&year=2026&month=9` · `/api/stats/funnel` | todos (según su alcance) |
| CRUD | `/api/companies` · `/api/contacts` · `/api/deals` · `/api/tasks` · `/api/messages` | según `canManage`; DELETE solo admin (tareas: su responsable) |
| POST | `/api/contacts/check-duplicates` · `/api/contacts/:id/activity` | todos |
| GET/POST | `/api/contacts/export.csv` · `/api/contacts/import` · `/api/deals/export.csv` | admin |
| CRUD | `/api/users` | admin |
| PUT | `/api/settings/stages` · `/api/settings/commissions` | admin |
| GET/POST | `/api/admin/audit` · `/api/admin/reports` · `/api/admin/backup` · `/api/admin/backup/import` · `/api/admin/automations/run` · `/api/admin/source` | admin |
