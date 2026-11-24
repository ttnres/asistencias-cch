(function () {
  "use strict";

  const environment = window.ENV || {};
  const TOKEN_STORAGE_KEY = "attendance-session-token";
  const PREVIEW_MODE = !environment.APPS_SCRIPT_URL ||
    environment.APPS_SCRIPT_URL === "PEGA_AQUI_TU_URL_EXEC";
  const DEMO_BOOTSTRAP = {
    cycles: ["2027-1"],
    courses: [{
      ID_Curso: 3162027,
      "Nombre Curso": "Matemáticas I",
      Grupo: "101",
      Horario: "Lunes y miércoles, 07:00-09:00",
      Ciclo_Escolar: "2027-1",
      Hoja_Reporte: "Reporte_Demo_3162027",
      Activo: true
    }],
    students: [
      { ID: "DEMO000001", Cuenta: "326278617", "First Name": "Ana Ejemplo", Email: "ana@example.invalid", Course: 3162027 },
      { ID: "DEMO000002", Cuenta: "326278618", "First Name": "Luis Ejemplo", Email: "luis@example.invalid", Course: 3162027 },
      { ID: "DEMO000003", Cuenta: "326278619", "First Name": "María Ejemplo", Email: "maria@example.invalid", Course: 3162027 }
    ],
    roles: []
  };
  const DEMO_MATRIX = {
    success: true,
    course: DEMO_BOOTSTRAP.courses[0],
    dates: [
      { iso: "2026-09-09", label: "09/09/2026" },
      { iso: "2026-09-14", label: "14/09/2026" },
      { iso: "2026-09-16", label: "16/09/2026" }
    ],
    students: [
      {
        ID: "DEMO000001",
        Cuenta: "326278617",
        "First Name": "Ana Ejemplo",
        asistencias: 2,
        faltas: 1,
        porcentaje: 66.67,
        estados: [
          { presente: true, hora: "07:55:55", logId: "a6ccd7a5" },
          { presente: false, hora: "", logId: "" },
          { presente: true, hora: "08:02:11", logId: "b7dde8b6" }
        ]
      },
      {
        ID: "DEMO000002",
        Cuenta: "326278618",
        "First Name": "Luis Ejemplo",
        asistencias: 2,
        faltas: 1,
        porcentaje: 66.67,
        estados: [
          { presente: true, hora: "07:58:10", logId: "c8eef9c7" },
          { presente: true, hora: "08:01:02", logId: "d9ffa0d8" },
          { presente: false, hora: "", logId: "" }
        ]
      },
      {
        ID: "DEMO000003",
        Cuenta: "326278619",
        "First Name": "María Ejemplo",
        asistencias: 1,
        faltas: 2,
        porcentaje: 33.33,
        estados: [
          { presente: false, hora: "", logId: "" },
          { presente: false, hora: "", logId: "" },
          { presente: true, hora: "08:05:27", logId: "ea01b1e9" }
        ]
      }
    ],
    warnings: []
  };
  const appState = {
    token: "",
    session: null,
    bootstrap: null,
    matrix: null,
    busy: false
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    cacheElements();
    configureBranding();
    bindEvents();

    elements["login-form"].hidden = PREVIEW_MODE;
    elements["demo-login-button"].hidden = !PREVIEW_MODE;
    elements["demo-login-info"].hidden = !PREVIEW_MODE;
    if (PREVIEW_MODE) {
      clearSession();
    }

    const savedToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (savedToken && !PREVIEW_MODE) {
      appState.token = savedToken;
      loadDashboard().catch(function (error) {
        clearSession();
        showLoginView();
        showLoginError(error.message);
      });
    }
  }

  function cacheElements() {
    [
      "institution-name", "application-name", "login-view", "dashboard-view",
      "login-form", "login-user", "login-pass", "login-submit", "login-alert",
      "demo-login-info",
      "dashboard-alert", "dashboard-notice", "session-label", "logout-button",
      "demo-login-button", "cycle-filter", "course-filter", "load-matrix-button",
      "export-button", "generate-report-button",
      "matrix-loading", "matrix-empty", "matrix-container", "matrix-head",
      "matrix-body", "course-summary", "setup-button"
    ].forEach(function (id) {
      elements[id] = document.getElementById(id);
    });
  }

  function configureBranding() {
    document.title = environment.APP_NAME || document.title;
    elements["institution-name"].textContent =
      environment.INSTITUTION || elements["institution-name"].textContent;
    elements["application-name"].textContent =
      environment.APP_NAME || elements["application-name"].textContent;
  }

  function bindEvents() {
    elements["login-form"].addEventListener("submit", handleLogin);
    elements["demo-login-button"].addEventListener("click", handleDemoLogin);
    elements["logout-button"].addEventListener("click", handleLogout);
    elements["cycle-filter"].addEventListener("change", updateCourseOptions);
    elements["load-matrix-button"].addEventListener("click", handleLoadMatrix);
    elements["export-button"].addEventListener("click", exportCurrentCourse);
    elements["generate-report-button"].addEventListener("click", handleGenerateReport);
    elements["setup-button"].addEventListener("click", handleRunSetup);
  }

  async function handleDemoLogin() {
    appState.session = {
      user: "demo@example.invalid",
      role: "Demostración local",
      isAdmin: false
    };
    await loadDashboard();
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearAlert(elements["login-alert"]);
    setButtonBusy(elements["login-submit"], true, "Validando...");

    try {
      const result = await apiRequest("login", {
        user: elements["login-user"].value.trim(),
        pass: elements["login-pass"].value
      }, false);
      appState.token = result.token;
      sessionStorage.setItem(TOKEN_STORAGE_KEY, result.token);
      appState.session = {
        user: result.user,
        role: result.role,
        isAdmin: result.isAdmin
      };
      elements["login-pass"].value = "";
      await loadDashboard();
    } catch (error) {
      clearSession();
      showLoginView();
      showLoginError(error.message);
    } finally {
      setButtonBusy(elements["login-submit"], false, "Entrar");
    }
  }

  async function loadDashboard() {
    showDashboardView();
    const data = PREVIEW_MODE
      ? cloneData(DEMO_BOOTSTRAP)
      : await apiRequest("getBootstrapData", {});
    appState.bootstrap = data;
    appState.session = data.session || appState.session;
    elements["session-label"].textContent =
      (appState.session.user || "") + " · " + (appState.session.role || "Usuario");
    elements["setup-button"].hidden = PREVIEW_MODE || !appState.session.isAdmin;
    populateCycleOptions(data.cycles || []);
    updateCourseOptions();
    clearAlert(elements["dashboard-alert"]);
    clearNotice();

    const selectedCourse = elements["course-filter"].value;
    if (selectedCourse) {
      await handleLoadMatrix();
    } else {
      resetMatrix("No hay grupos disponibles para esta cuenta y ciclo.");
    }
    if (PREVIEW_MODE) {
      showNotice("Modo demostración: estos datos son locales y no se guardan en Google Sheets. Configura la URL /exec en env.js para conectar datos reales.");
    }
  }

  function populateCycleOptions(cycles) {
    const select = elements["cycle-filter"];
    select.replaceChildren();

    if (!cycles.length) {
      appendOption(select, "", "Sin ciclos disponibles");
      select.disabled = true;
      return;
    }

    select.disabled = false;
    cycles.forEach(function (cycle) {
      appendOption(select, cycle, cycle);
    });
    select.value = cycles.indexOf(environment.DEFAULT_CICLO) >= 0
      ? environment.DEFAULT_CICLO
      : cycles[0];
  }

  function updateCourseOptions() {
    const cycle = elements["cycle-filter"].value;
    const courses = (appState.bootstrap && appState.bootstrap.courses || []).filter(function (course) {
      return String(course.Ciclo_Escolar || "").trim() === cycle;
    });
    const select = elements["course-filter"];
    const previousValue = select.value;
    select.replaceChildren();
    courses.forEach(function (course) {
      const title = [course["Nombre Curso"], course.Grupo]
        .filter(Boolean)
        .join(" · ");
      const label = title + " (" + cycle + ")";
      appendOption(select, String(course.ID_Curso), label);
    });
    select.disabled = courses.length === 0;
    if (courses.some(function (course) {
      return String(course.ID_Curso) === previousValue;
    })) {
      select.value = previousValue;
    }
    elements["export-button"].disabled = true;
    elements["generate-report-button"].disabled = true;
    appState.matrix = null;
    resetMatrix(courses.length ? "Carga un grupo para ver su matriz." : "No hay grupos en este ciclo.");
    clearAlert(elements["dashboard-alert"]);
  }

  async function handleLoadMatrix() {
    const courseId = elements["course-filter"].value;
    const cycle = elements["cycle-filter"].value;
    if (!courseId || !cycle) {
      resetMatrix("Selecciona un ciclo y un grupo disponibles.");
      return;
    }

    clearAlert(elements["dashboard-alert"]);
    elements["matrix-loading"].hidden = false;
    elements["matrix-empty"].hidden = true;
    elements["matrix-container"].hidden = true;
    elements["export-button"].disabled = true;
    setButtonBusy(elements["load-matrix-button"], true, "Cargando...");

    try {
      const result = PREVIEW_MODE
        ? cloneData(DEMO_MATRIX)
        : await apiRequest("getAttendanceMatrix", {
          cicloEscolar: cycle,
          idCurso: courseId
        });
      appState.matrix = result;
      renderMatrix(result);
      elements["export-button"].disabled = false;
      elements["generate-report-button"].disabled = PREVIEW_MODE || !result.students.length;
      showWarnings(result.warnings || []);
    } catch (error) {
      resetMatrix("No se pudo cargar la matriz.");
      showDashboardError(error.message);
    } finally {
      elements["matrix-loading"].hidden = true;
      setButtonBusy(elements["load-matrix-button"], false, "Cargar matriz");
    }
  }

  function renderMatrix(matrix) {
    const course = matrix.course || {};
    elements["course-summary"].replaceChildren();
    const heading = document.createElement("h2");
    heading.className = "h5 mb-1";
    heading.textContent = [
      course["Nombre Curso"],
      course.Grupo && "Grupo " + course.Grupo
    ].filter(Boolean).join(" · ") || "Curso";
    const details = document.createElement("p");
    details.className = "text-secondary small mb-0";
    details.textContent = [
      "Ciclo " + (course.Ciclo_Escolar || ""),
      course.Horario && "Horario " + course.Horario,
      "Fechas registradas: " + (matrix.dates || []).length
    ].filter(Boolean).join(" · ");
    elements["course-summary"].append(heading, details);

    const headRow = document.createElement("tr");
    appendHeaderCell(headRow, "Alumno", "student-name");
    appendHeaderCell(headRow, "Cuenta", "student-account");
    appendHeaderCell(headRow, "Asistencias", "");
    appendHeaderCell(headRow, "Faltas", "");
    appendHeaderCell(headRow, "% asistencia", "");
    (matrix.dates || []).forEach(function (date) {
      appendHeaderCell(headRow, date.label, "status-cell");
    });
    elements["matrix-head"].replaceChildren(headRow);
    elements["matrix-body"].replaceChildren();

    const students = matrix.students || [];
    students.forEach(function (student) {
      const row = document.createElement("tr");
      const nameCell = document.createElement("th");
      nameCell.scope = "row";
      nameCell.className = "student-name";
      nameCell.textContent = student["First Name"] || "(Sin nombre)";
      row.appendChild(nameCell);
      appendCell(row, student.Cuenta || "", "student-account");
      appendCell(row, String(student.asistencias || 0), "");
      appendCell(row, String(student.faltas || 0), "");

      const indicatorCell = document.createElement("td");
      const indicator = document.createElement("span");
      const percentage = Number(student.porcentaje || 0);
      indicator.className = "badge attendance-indicator " + indicatorClass(percentage);
      indicator.textContent = percentage.toFixed(2) + "%";
      indicatorCell.appendChild(indicator);
      row.appendChild(indicatorCell);

      (student.estados || []).forEach(function (status, index) {
        const cell = document.createElement("td");
        cell.className = "status-cell";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "btn btn-sm attendance-toggle " +
          (status.presente ? "is-present" : "is-absent");
        toggle.textContent = status.presente ? "Presente" : "Falta";
        toggle.title = status.presente
          ? "Presente" + (status.hora ? " · " + status.hora : "") + ". Pulsa para retirar."
          : "Falta. Pulsa para registrar asistencia.";
        toggle.setAttribute("aria-label",
          student["First Name"] + ", " + matrix.dates[index].label + ": " + toggle.textContent);
        toggle.addEventListener("click", function () {
          toggleStudentAttendance(student, matrix.dates[index], toggle);
        });
        cell.appendChild(toggle);
        if (status.hora) {
          const time = document.createElement("div");
          time.className = "small text-secondary mt-1";
          time.textContent = status.hora;
          cell.appendChild(time);
        }
        row.appendChild(cell);
      });
      elements["matrix-body"].appendChild(row);
    });

    if (!students.length) {
      resetMatrix("No hay alumnos inscritos en este curso.");
      return;
    }
    elements["matrix-container"].hidden = false;
    elements["matrix-empty"].hidden = true;
  }

  function indicatorClass(percentage) {
    const minimum = Number(environment.MIN_ATTENDANCE_PERCENT);
    const warning = Number(environment.WARNING_ATTENDANCE_PERCENT);
    if (percentage < minimum) {
      return "text-bg-danger";
    }
    if (percentage < warning) {
      return "text-bg-warning";
    }
    return "text-bg-success";
  }

  async function toggleStudentAttendance(student, date, button) {
    if (!appState.matrix || button.disabled) {
      return;
    }
    button.disabled = true;
    try {
      if (PREVIEW_MODE) {
        toggleDemoAttendance(student.ID, date.iso);
        return;
      }
      await apiRequest("toggleAttendance", {
        cicloEscolar: appState.matrix.course.Ciclo_Escolar,
        idCurso: appState.matrix.course.ID_Curso,
        idEstudiante: student.ID,
        fecha: date.iso
      });
      await handleLoadMatrix();
    } catch (error) {
      button.disabled = false;
      showDashboardError(error.message);
    }
  }

  function toggleDemoAttendance(studentId, isoDate) {
    const matrix = appState.matrix;
    const dateIndex = matrix.dates.findIndex(function (date) {
      return date.iso === isoDate;
    });
    const student = matrix.students.find(function (item) {
      return String(item.ID) === String(studentId);
    });
    if (!student || dateIndex < 0) {
      return;
    }

    const status = student.estados[dateIndex];
    status.presente = !status.presente;
    status.hora = status.presente ? "08:00:00" : "";
    status.logId = status.presente ? "d3e01234" : "";

    const retainedDateIndexes = matrix.dates.map(function (date, index) {
      return index;
    }).filter(function (index) {
      return matrix.students.some(function (item) {
        return item.estados[index].presente;
      });
    });
    if (retainedDateIndexes.length !== matrix.dates.length) {
      matrix.dates = retainedDateIndexes.map(function (index) {
        return matrix.dates[index];
      });
      matrix.students.forEach(function (item) {
        item.estados = retainedDateIndexes.map(function (index) {
          return item.estados[index];
        });
      });
    }

    matrix.students.forEach(function (item) {
      item.asistencias = item.estados.filter(function (itemStatus) {
        return itemStatus.presente;
      }).length;
      item.faltas = item.estados.length - item.asistencias;
      item.porcentaje = item.estados.length
        ? Math.round((item.asistencias / item.estados.length) * 10000) / 100
        : 0;
    });
    renderMatrix(matrix);
    elements["export-button"].disabled = false;
    elements["generate-report-button"].disabled = true;
    showNotice("Modo demostración: el cambio es temporal y no se guarda en Sheets.");
  }

  async function handleGenerateReport() {
    if (PREVIEW_MODE) {
      showNotice("La generación en Sheets requiere configurar una URL /exec válida en env.js.");
      return;
    }
    if (!appState.matrix) {
      showDashboardError("Carga primero la matriz del grupo que quieres generar.");
      return;
    }

    const button = elements["generate-report-button"];
    setButtonBusy(button, true, "Generando...");
    try {
      const result = await apiRequest("generateReport", {
        cicloEscolar: appState.matrix.course.Ciclo_Escolar,
        idCurso: appState.matrix.course.ID_Curso
      });
      showNotice(
        result.message + " Columnas de fechas: " + result.dateColumnCount +
        ". Columnas sin ninguna asistencia descartadas: " +
        result.removedAllAbsenceDateColumns + "."
      );
    } catch (error) {
      showDashboardError(error.message);
    } finally {
      setButtonBusy(button, false, "Generar hoja Reporte");
    }
  }

  function exportCurrentCourse() {
    if (!appState.matrix || !window.XLSX) {
      showDashboardError("La matriz o la librería de Excel no está disponible.");
      return;
    }

    const matrix = appState.matrix;
    const course = matrix.course;
    const rows = [
      ["Curso", course["Nombre Curso"] || ""],
      ["Grupo", course.Grupo || ""],
      ["ID_Curso", course.ID_Curso || ""],
      ["Ciclo escolar", course.Ciclo_Escolar || ""],
      ["Horario", course.Horario || ""],
      [],
      [
        "ID estudiante",
        "Alumno",
        "Cuenta",
        "Asistencias",
        "Faltas",
        "Porcentaje"
      ].concat(matrix.dates.map(function (date) {
        return date.label;
      }))
    ];

    matrix.students.forEach(function (student) {
      const attendanceCells = student.estados.map(function (status) {
        return status.presente
          ? "Presente" + (status.hora ? " " + status.hora : "")
          : "Falta";
      });
      rows.push([
        student.ID,
        student["First Name"] || "",
        student.Cuenta || "",
        student.asistencias,
        student.faltas,
        Number(student.porcentaje || 0) / 100
      ].concat(attendanceCells));
    });

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    matrix.students.forEach(function (student, index) {
      const percentageAddress = XLSX.utils.encode_cell({ r: 7 + index, c: 5 });
      if (worksheet[percentageAddress]) {
        worksheet[percentageAddress].z = "0.00%";
      }
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Asistencias");

    const filename = [
      safeFilenamePart(course.Grupo || course["Nombre Curso"] || "grupo"),
      safeFilenamePart(course.Ciclo_Escolar || "ciclo")
    ].join("_") + ".xlsx";
    XLSX.writeFile(workbook, filename, { bookType: "xlsx" });
  }

  async function handleRunSetup() {
    if (PREVIEW_MODE) {
      showDashboardError("El modo demostración no está conectado a Google Sheets.");
      return;
    }
    if (!appState.session || !appState.session.isAdmin) {
      showDashboardError("Solo una cuenta administradora puede verificar los encabezados.");
      return;
    }
    const button = elements["setup-button"];
    setButtonBusy(button, true, "Verificando...");
    try {
      const result = await apiRequest("runSetup", {});
      showNotice(result.message || "Encabezados verificados.");
      await loadDashboard();
    } catch (error) {
      showDashboardError(error.message);
    } finally {
      setButtonBusy(button, false, "Verificar encabezados");
    }
  }

  async function apiRequest(action, data, authenticated) {
    if (PREVIEW_MODE) {
      throw new Error("Configura APPS_SCRIPT_URL en env.js con la URL /exec de tu implementación.");
    }

    const payload = Object.assign({ action: action }, data || {});
    if (authenticated !== false) {
      if (!appState.token) {
        throw new Error("Inicia sesión para continuar.");
      }
      payload.token = appState.token;
    }

    let response;
    try {
      response = await fetch(environment.APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow"
      });
    } catch (error) {
      throw new Error(
        "No fue posible conectar con Apps Script. Revisa la URL /exec, la implementación pública " +
        "y el acceso CORS del navegador."
      );
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error(
        "Apps Script no devolvió JSON. Verifica que la URL termine en /exec y que la implementación esté activa."
      );
    }
    if (!response.ok || !result.success) {
      const message = result.error || "La solicitud no pudo completarse.";
      if (/sesión/i.test(message)) {
        clearSession();
        showLoginView();
      }
      throw new Error(message);
    }
    return result;
  }

  function handleLogout() {
    clearSession();
    appState.bootstrap = null;
    appState.matrix = null;
    elements["login-form"].reset();
    clearAlert(elements["login-alert"]);
    showLoginView();
  }

  function clearSession() {
    appState.token = "";
    appState.session = null;
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  function showLoginView() {
    elements["login-view"].hidden = false;
    elements["dashboard-view"].hidden = true;
  }

  function showDashboardView() {
    elements["login-view"].hidden = true;
    elements["dashboard-view"].hidden = false;
  }

  function resetMatrix(message) {
    appState.matrix = null;
    elements["course-summary"].replaceChildren();
    elements["matrix-head"].replaceChildren();
    elements["matrix-body"].replaceChildren();
    elements["matrix-container"].hidden = true;
    elements["matrix-empty"].textContent = message;
    elements["matrix-empty"].hidden = false;
    elements["export-button"].disabled = true;
    elements["generate-report-button"].disabled = true;
  }

  function showWarnings(warnings) {
    if (!warnings.length) {
      clearNotice();
      return;
    }
    showNotice(warnings.join(" "));
  }

  function showLoginError(message) {
    showAlert(elements["login-alert"], message);
  }

  function showDashboardError(message) {
    showAlert(elements["dashboard-alert"], message);
  }

  function showAlert(element, message) {
    element.textContent = message;
    element.hidden = false;
  }

  function clearAlert(element) {
    element.textContent = "";
    element.hidden = true;
  }

  function showNotice(message) {
    elements["dashboard-notice"].textContent = message;
    elements["dashboard-notice"].hidden = false;
  }

  function clearNotice() {
    elements["dashboard-notice"].textContent = "";
    elements["dashboard-notice"].hidden = true;
  }

  function appendOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function appendHeaderCell(row, label, className) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    if (className) {
      cell.className = className;
    }
    row.appendChild(cell);
  }

  function appendCell(row, value, className) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    if (className) {
      cell.className = className;
    }
    row.appendChild(cell);
  }

  function safeFilenamePart(value) {
    return String(value).trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "-");
  }

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setButtonBusy(button, busy, label) {
    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = button.textContent;
    }
    button.disabled = busy;
    button.textContent = busy ? label : button.dataset.originalLabel;
  }
})();
