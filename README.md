# Control de Asistencias Académicas

Aplicación para consultar y actualizar asistencias del **CCH Plantel Oriente - UNAM**. Las cuatro tablas base de Google Sheets se conectan con AppSheet; Google Apps Script publica las operaciones del backend y la aplicación estática en GitHub Pages muestra la matriz. Por solicitud del usuario, también existe una acción explícita que crea o actualiza una pestaña de reporte físico para el curso seleccionado.

## Arquitectura

```text
GitHub Pages (index.html, app.js, env.js)
        │ HTTPS, JSON en POST text/plain
        ▼
Google Apps Script (Code.gs: doGet / doPost)
        │ SpreadsheetApp
        ▼
Google Sheets (Course, Students, Attendance Log, Roles)
        ├── Google AppSheet se conecta a estas cuatro tablas
        └── Pestañas Reporte... opcionales, generadas bajo demanda por el panel
```

La interfaz consulta una combinación de **un curso y un ciclo escolar a la vez**. La descarga contiene solamente ese grupo y se genera como un libro Excel `.xlsx` con SheetJS. La matriz coloreada se dibuja en el navegador. El botón **Generar hoja Reporte** es una acción separada: crea o actualiza la hoja indicada en `Course.Hoja_Reporte` (o `Reporte_<ID_Curso>` si está vacío).

## Componentes entregados

### `Code.gs`

- Define e inicializa las cuatro tablas mediante `setupDatabase()`. El menú de Sheets **📋 Sistema Asistencias → Verificar / Renombrar Encabezados (AppSheet)** llama la misma función.
- Crea las hojas faltantes y reemplaza únicamente la fila 1 de las hojas existentes; no limpia ni reordena las filas de datos. Aplica fondo negro, texto blanco en negritas y congela la fila de encabezados.
- Expone `doGet` y `doPost`, con respuestas JSON de `ContentService`. Los errores se devuelven explícitamente como `{ success: false, error: "..." }`.
- Implementa `login`, `getBootstrapData`, `getAttendanceMatrix`, `toggleAttendance`, `generateReport` y `runSetup`.
- Usa propiedades del script para las credenciales y una sesión temporal en `CacheService`. Las escrituras manuales se protegen con `LockService`.
- Normaliza identificadores, interpreta fechas `d/MM/yyyy`, `dd/MM/yyyy` e ISO, y busca coincidencias de asistencia en mapas por alumno/fecha.
- Al generar un reporte, limita las columnas de fecha a las que contienen al menos una asistencia. Elimina las columnas de fechas sin ninguna celda que contenga `Asistencia` (sin distinguir mayúsculas/minúsculas), reescribe la matriz de esa pestaña y conserva las demás hojas del libro.

### `env.js`

Configuración pública cargada por la web. Reemplaza `PEGA_AQUI_TU_URL_EXEC` por la URL de implementación de Apps Script terminada en `/exec`. No pongas contraseñas ni secretos en este archivo: GitHub Pages lo publica.

### `index.html`

Contiene la pantalla institucional de bienvenida, formulario de acceso y panel responsivo con Bootstrap 5.3.3. Carga SheetJS desde CDN para escribir libros `.xlsx`.

### `app.js`

Consume la API, filtra cursos por ciclo, presenta la matriz y sus totales, permite marcar o retirar manualmente una asistencia, genera el reporte físico bajo demanda y exporta el grupo actualmente seleccionado. Si `APPS_SCRIPT_URL` conserva el marcador de posición, abre una demostración local con datos ficticios; no inicia sesión en el backend ni escribe en Sheets. Al configurar la URL `/exec` y recargar la página, cambia automáticamente al backend real y deja de usar esos datos.

### `README.md`

Este manual describe el esquema, comportamiento, seguridad y despliegue.

## Esquema de datos compatible con AppSheet

Los encabezados son exactos, están en la fila 1 y el orden es significativo para el modelo:

| Hoja | Propósito | Encabezados |
| --- | --- | --- |
| `Course` | Un registro por grupo/materia | `ID_Curso`, `Nombre Curso`, `Grupo`, `Horario`, `Ciclo_Escolar`, `Hoja_Reporte`, `Activo` |
| `Students` | Un registro por inscripción | `ID`, `Cuenta`, `First Name`, `Email`, `Course` |
| `Attendance Log` | Asistencias QR y manuales | `id`, `fk_id_student`, `Cuenta`, `Course`, `Date`, `Time` |
| `Roles` | Rol y alcance de curso | `ID`, `ID_Curso`, `Nombre`, `Correo`, `Rol` |

`setupDatabase()` garantiza esas cuatro hojas y encabezados, pero no elimina hojas adicionales. La acción **Generar hoja Reporte** crea intencionalmente una pestaña adicional de salida; por ello, el libro tendrá las cuatro tablas base más las pestañas de reportes que se generen. Para conservar un libro con solo cuatro pestañas, no uses esa acción. Las hojas preexistentes no se eliminan automáticamente.

Las columnas `Attendance Log.Cuenta` y `Attendance Log.Course` se escriben como números cuando se registra asistencia manual. `Date` y `Time` se guardan como valores de fecha/hora de Sheets con formatos `dd/MM/yyyy` y `HH:mm:ss`. El ID de asistencia manual es un hexadecimal en minúsculas de ocho caracteres; el identificador de alumno se toma de `Students.ID`.

## Ciclos escolares e inscripciones

`Students` y `Attendance Log` no tienen columna `Ciclo_Escolar`. La asociación se resuelve por `Course`/`ID_Curso` y luego por el registro del curso en `Course`, cuyo `Ciclo_Escolar` identifica la inscripción. Por tanto:

1. Asigna un `ID_Curso` único a cada grupo/materia de cada ciclo, conserva ese código en `Students.Course` y `Attendance Log.Course`, y no lo reutilices en otro ciclo.
2. Para no mezclar historiales, el backend detecta un `ID_Curso` que aparezca en varios ciclos y rechaza la consulta o edición en vez de adivinar a cuál corresponde.
3. La cuenta de un alumno puede repetirse en inscripciones de ciclos diferentes siempre que cada inscripción utilice su propio `ID` y `ID_Curso`.
4. Los registros de asistencia que no correspondan a una inscripción del curso seleccionado no se agregan a la matriz. Los registros del curso con una fecha inválida se omiten y se notifican en el panel.

El denominador del porcentaje es el número de fechas únicas que tienen por lo menos una asistencia válida para ese curso. Por ello, una fecha sin ningún registro en `Attendance Log` no se puede inferir como día impartido ni contar como falta; para una lista completa de clases se necesitaría una tabla de sesiones/calendario, que no forma parte del esquema pedido.

## Generar hoja física de reporte

1. Selecciona ciclo y grupo, y pulsa **Cargar matriz**. Esa acción solo consulta; no escribe en Sheets.
2. Pulsa **Generar hoja Reporte** para crear o actualizar la pestaña del grupo. El nombre sale de `Course.Hoja_Reporte`; si está vacío, se usa `Reporte_<ID_Curso>`. El nombre debe contener `Reporte` en cualquier posición y combinación de mayúsculas/minúsculas.
3. La pestaña contiene datos del alumno, totales y una columna por fecha con asistencia. Cada celda de fecha se escribe como `Asistencia` o `Falta`.
4. Al actualizar, el generador reemplaza el contenido de la matriz en esa pestaña; no modifica las otras pestañas del libro. Las columnas de fecha anteriores que ya no correspondan se quitan de la salida. Además, se eliminan columnas de fecha cuyo contenido no incluya `Asistencia`, sin distinguir mayúsculas/minúsculas.
5. Las fechas se originan en registros válidos de `Attendance Log` para el curso y ciclo. Una fecha sin ninguna asistencia válida no se crea, así no puede quedar una columna compuesta solo por `Falta`.

La regla de eliminación se ejecuta al generar/actualizar el reporte, no como un disparador automático cuando alguien edita manualmente una hoja en Sheets. Para ejecutar la limpieza y actualización usa el botón del panel.

## Indicadores visuales

- **Rojo:** asistencia por debajo de `MIN_ATTENDANCE_PERCENT` (80 % por configuración predeterminada).
- **Amarillo:** desde el mínimo hasta antes de `WARNING_ATTENDANCE_PERCENT` (85 %).
- **Verde:** igual o superior al umbral de advertencia.

Se muestran asistencias, faltas (fechas de la matriz sin marca) y porcentaje. Si no existen fechas, el porcentaje es 0 %.

## API

Todas las acciones de la web se envían como JSON en el cuerpo de `POST` con `Content-Type: text/plain;charset=utf-8`, evitando el preflight de una solicitud JSON convencional. Apps Script no permite configurar encabezados arbitrarios de CORS en `ContentService`; el navegador debe poder leer la respuesta de la implementación de Google. No uses `mode: "no-cors"`: produciría una respuesta opaca que la aplicación no puede procesar.

Las acciones protegidas reciben `token`, emitido al iniciar sesión y almacenado en el `CacheService` del script durante seis horas. El token se conserva en `sessionStorage` del navegador y se elimina al cerrar sesión o al expirar.

| Acción | Campos adicionales | Resultado |
| --- | --- | --- |
| `login` | `user`, `pass` | Token y rol de sesión |
| `getBootstrapData` | — | Ciclos, cursos permitidos, alumnos de esos cursos y registros de rol pertinentes |
| `getAttendanceMatrix` | `cicloEscolar`, `idCurso` | Curso, fechas ordenadas, estados y totales por alumno |
| `toggleAttendance` | `cicloEscolar`, `idCurso`, `idEstudiante`, `fecha` (`yyyy-MM-dd`) | Inserta una marca o retira las existentes para ese alumno/curso/fecha |
| `generateReport` | `cicloEscolar`, `idCurso` | Crea/actualiza la pestaña de reporte y elimina columnas de fecha sin `Asistencia` |
| `runSetup` | — | Verifica/normaliza encabezados (solo administrador) |

`doGet` también acepta `action`, `token` y los parámetros correspondientes en la query string. La interfaz utiliza `doPost` para no exponer credenciales o tokens en la URL.

La matriz devuelve fechas `{ iso, label }` y para cada alumno `estados`, con `{ presente, hora, logId }` por fecha, además de `asistencias`, `faltas` y `porcentaje`. Los IDs QR preexistentes y los IDs manuales se tratan como texto hexadecimal.

## Autenticación y permisos

1. En el editor de Apps Script abre **Configuración del proyecto → Propiedades de la secuencia de comandos** y crea `ADMIN_USER` y `ADMIN_PASS`.
2. El endpoint exige que la contraseña coincida con `ADMIN_PASS`. La hoja `Roles` no contiene contraseña ni una columna `Activo`, así que no puede autenticar por sí sola ni demostrar un estado activo independiente. Para respetar el esquema solicitado sin almacenar contraseñas en texto plano, un correo que aparezca en `Roles` con un `Rol` habilitado puede iniciar sesión usando la contraseña compartida `ADMIN_PASS`. Un `Rol` no vacío (distinto de `Inactivo`, `Inactive` o `false`) se considera habilitado.
3. La cuenta configurada en `ADMIN_USER` tiene permisos de administración. Otras cuentas reconocidas en `Roles` quedan limitadas a los `ID_Curso` asignados en sus filas. No se recomienda publicar una implementación de escritura abierta.
4. Esta autenticación sencilla no sustituye un proveedor de identidad. Las cuentas de `Roles` comparten `ADMIN_PASS`; no ofrecen contraseñas individuales, recuperación de contraseñas ni auditoría por persona.

> **Nota de diseño:** el esquema pedido no permite credenciales individuales por cada fila de `Roles`, ni incluye un campo `Activo` en esa tabla. Si se requiere autenticar a varias personas con contraseñas individuales y deshabilitarlas, hay que acordar y añadir un mecanismo de identidad o una tabla de usuarios protegida; no se deben guardar contraseñas en texto plano en `Roles`.

## Despliegue

### 1. Preparar Google Sheets y Apps Script

1. Abre el libro de Sheets destinado a la base de datos. Revisa y respalda las hojas antiguas antes de modificar el proyecto.
2. En **Extensiones → Apps Script**, reemplaza el contenido de `Code.gs` con el archivo entregado. El proyecto debe estar vinculado al libro.
3. Guarda y ejecuta `setupDatabase()` desde el editor. Autoriza los permisos solicitados. Verifica que existan los cuatro encabezados exactos y que los datos anteriores permanezcan debajo de la fila 1.
4. Comprueba que cada `Course.ID_Curso` sea único entre ciclos y que los valores de `Students.Course` y `Attendance Log.Course` coincidan con ese código.
5. Configura `ADMIN_USER` y `ADMIN_PASS` en las propiedades del script. Usa una contraseña fuerte y no la escribas en archivos del repositorio.
6. Despliega como **Aplicación web**. Selecciona ejecutar como el propietario del script. Configura el acceso para las personas autorizadas por la política institucional; evita permitir escritura pública. Copia la URL que termina en `/exec`.

### 2. Publicar en GitHub Pages

1. Sube `index.html`, `app.js` y `env.js` al repositorio que servirá la web.
2. En `env.js`, reemplaza el valor de `APPS_SCRIPT_URL` por la URL `/exec` recién desplegada.
3. Habilita GitHub Pages para la rama y carpeta correspondientes. Abre la URL HTTPS publicada.
4. Antes de configurar `/exec`, puedes usar **Entrar a demostración local** para probar la interfaz con datos ficticios. La demostración no crea ni modifica hojas, y las ediciones son temporales. Al colocar una URL distinta del marcador en `env.js` y recargar la página, el frontend deja de usar los datos ficticios y llama a Apps Script.
5. Inicia sesión y prueba el filtro de ciclo, la matriz, la exportación de un solo grupo y el botón **Generar hoja Reporte**. Comprueba también el registro y retiro manual de una asistencia de prueba.

Si actualizas el código de Apps Script después de publicar, crea una nueva versión de la implementación web para que `/exec` utilice los cambios. Si el navegador informa un error de red/CORS, confirma que el despliegue sea accesible para esa persona, que `env.js` tenga la URL de Apps Script correcta y que no se esté usando una URL `/dev`; Apps Script no ofrece en `ContentService` una API para agregar un encabezado CORS arbitrario.

## Integración con AppSheet

En AppSheet, conecta el mismo libro y agrega las tablas `Course`, `Students`, `Attendance Log` y `Roles`. Usa los encabezados indicados literalmente y configura los tipos/llaves de acuerdo con los IDs que ya utiliza la aplicación. Mantén `Attendance Log.id` como valor único; no permitas que una regeneración de llave modifique identificadores ya utilizados. La web y AppSheet comparten datos, por lo que un cambio hecho en cualquiera de ellos se verá en la siguiente consulta.

`Hoja_Reporte` se utiliza como nombre de la pestaña física generada. Si el campo está vacío, la API propone `Reporte_<ID_Curso>`. El generador rechaza nombres que no incluyan la palabra `Reporte`, para no aplicar la regla de limpieza a una pestaña ajena. La pestaña seleccionada se considera propiedad del reporte: al regenerarla se reemplaza su matriz anterior, pero se conservan todas las demás pestañas del libro.

## Dependencias de frontend

- Bootstrap 5.3.3 por CDN para el diseño responsivo.
- SheetJS/XLSX 0.18.5 por CDN para generar un archivo `.xlsx` real en el navegador.

La exportación contiene metadatos del curso y la matriz del curso actualmente seleccionado. No se generan archivos CSV ni exportaciones de varios grupos en una sola acción. La conectividad a los CDN es necesaria para el estilo y la exportación.

## Cambios de arquitectura respecto al script anterior

- La matriz web reemplaza el reporte físico como vista principal; se añadió una generación física opcional y explícita a petición del usuario.
- Los reportes físicos se crean/actualizan solo al pulsar **Generar hoja Reporte**, con limpieza de columnas de fecha sin asistencia.
- Se separaron el backend API, la configuración pública y la interfaz estática en los archivos solicitados.
- Se normalizaron los encabezados para el uso compartido con AppSheet sin reescribir filas existentes.
- Se añadió selección explícita de ciclo y curso para limitar cada consulta/exportación.
- Se añadió registro manual protegido por bloqueo, ID hexadecimal de ocho caracteres y formato real de fecha/hora de Sheets.
- Se incorporaron login, token temporal, mensajes de error y filtros de acceso por curso.
