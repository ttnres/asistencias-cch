const DATABASE_SCHEMA_ = [
  {
    name: "Course",
    headers: ["ID_Curso", "Nombre Curso", "Grupo", "Horario", "Ciclo_Escolar", "Hoja_Reporte", "Activo"]
  },
  {
    name: "Students",
    headers: ["ID", "Cuenta", "First Name", "Email", "Course"]
  },
  {
    name: "Attendance Log",
    headers: ["id", "fk_id_student", "Cuenta", "Course", "Date", "Time", "Estado"]
  },
  {
    name: "Roles",
    headers: ["ID", "ID_Curso", "Nombre", "Correo", "Rol"]
  }
];

const SESSION_CACHE_PREFIX_ = "attendance-session:";
const SESSION_TTL_SECONDS_ = 21600;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("📋 Sistema Asistencias")
    .addItem("Verificar / Renombrar Encabezados (AppSheet)", "setupDatabase")
    .addToUi();
}

function setupDatabase() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = getSpreadsheet_();
    DATABASE_SCHEMA_.forEach(function (table) {
      let sheet = spreadsheet.getSheetByName(table.name);
      if (!sheet) {
        sheet = spreadsheet.insertSheet(table.name);
      }

      const previousLastColumn = sheet.getLastColumn();
      if (previousLastColumn > table.headers.length) {
        sheet.getRange(1, table.headers.length + 1, 1, previousLastColumn - table.headers.length)
          .clearContent();
      }

      const headerRange = sheet.getRange(1, 1, 1, table.headers.length);
      headerRange
        .setValues([table.headers])
        .setBackground("#000000")
        .setFontColor("#ffffff")
        .setFontWeight("bold");
      sheet.setFrozenRows(1);
    });

    return {
      success: true,
      message: "Las cuatro tablas requeridas existen y sus encabezados están normalizados."
    };
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    const parameters = e && e.parameter ? e.parameter : {};
    return jsonOutput_(dispatchRequest_(parameters.action, parameters, parameters.token));
  } catch (error) {
    logApiError_(error);
    return jsonOutput_({ success: false, error: error.message || "Error interno de la API." });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || typeof e.postData.contents !== "string") {
      throw new Error("El cuerpo de la solicitud debe contener JSON.");
    }

    const payload = JSON.parse(e.postData.contents);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("El cuerpo JSON debe ser un objeto.");
    }

    return jsonOutput_(dispatchRequest_(payload.action, payload, payload.token));
  } catch (error) {
    logApiError_(error);
    return jsonOutput_({ success: false, error: error.message || "Error interno de la API." });
  }
}

function dispatchRequest_(action, payload, token) {
  if (action === "login") {
    return login_(payload);
  }

  const session = requireSession_(token);
  if (action === "getBootstrapData") {
    return getBootstrapData_(session);
  }
  if (action === "getAttendanceMatrix") {
    return getAttendanceMatrix_(session, payload.cicloEscolar, payload.idCurso);
  }
  if (action === "saveAttendanceChanges") {
    return saveAttendanceChanges_(session, payload);
  }
  if (action === "generateReport") {
    return generateReport_(session, payload);
  }
  if (action === "runSetup") {
    requireAdministrator_(session);
    return setupDatabase();
  }

  throw new Error("Acción no reconocida.");
}

function login_(payload) {
  const properties = PropertiesService.getScriptProperties();
  const configuredUser = properties.getProperty("ADMIN_USER");
  const configuredPassword = properties.getProperty("ADMIN_PASS");
  const user = String(payload.user || "").trim();
  const password = String(payload.pass || "");

  if (!configuredUser || !configuredPassword) {
    throw new Error("Faltan ADMIN_USER o ADMIN_PASS en las Propiedades de las secuencias de comandos.");
  }
  if (!user || !password) {
    throw new Error("Escribe usuario y contraseña.");
  }
  const matchingRoles = readRows_("Roles").filter(function (row) {
    return normalizeEmail_(row.Correo) === normalizeEmail_(user) &&
      isActiveRole_(row.Rol);
  });
  const validPassword = password === configuredPassword;
  const isAdmin = user === String(configuredUser).trim() && validPassword;
  if (!validPassword || (!isAdmin && !matchingRoles.length)) {
    throw new Error("Usuario o contraseña incorrectos, o no existe un rol habilitado.");
  }
  const courseIds = Array.from(new Set(matchingRoles.map(function (row) {
    return normalizarId_(row.ID_Curso);
  }).filter(Boolean)));
  const session = {
    user: user,
    role: matchingRoles.length
      ? Array.from(new Set(matchingRoles.map(function (row) {
        return String(row.Rol).trim();
      }))).join(", ")
      : (isAdmin ? "Administrador" : "Usuario"),
    courseIds: courseIds,
    isAdmin: isAdmin
  };
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "").slice(0, 8);

  CacheService.getScriptCache().put(
    SESSION_CACHE_PREFIX_ + token,
    JSON.stringify(session),
    SESSION_TTL_SECONDS_
  );

  return {
    success: true,
    token: token,
    user: session.user,
    role: session.role,
    isAdmin: session.isAdmin,
    expiresInSeconds: SESSION_TTL_SECONDS_
  };
}

function getBootstrapData_(session) {
  const courseRows = readRows_("Course").filter(function (row) {
    const courseId = normalizarId_(row.ID_Curso);
    return !!courseId && isActive_(row.Activo) &&
      hasCourseAccess_(session, courseId);
  });
  const courses = courseRows.map(function (row) {
    return {
      ID_Curso: row.ID_Curso,
      "Nombre Curso": row["Nombre Curso"],
      Grupo: row.Grupo,
      Horario: row.Horario,
      Ciclo_Escolar: String(row.Ciclo_Escolar || "").trim(),
      Hoja_Reporte: row.Hoja_Reporte,
      Activo: row.Activo
    };
  });
  const availableCourseIds = {};
  courses.forEach(function (course) {
    availableCourseIds[normalizarId_(course.ID_Curso)] = true;
  });
  const students = readRows_("Students")
    .filter(function (student) {
      return !!availableCourseIds[normalizarId_(student.Course)];
    })
    .map(function (student) {
      return {
        ID: student.ID,
        Cuenta: student.Cuenta,
        "First Name": student["First Name"],
        Email: student.Email,
        Course: student.Course
      };
    });
  const roles = readRows_("Roles")
    .filter(function (row) {
      return session.isAdmin ||
        normalizeEmail_(row.Correo) === normalizeEmail_(session.user);
    })
    .map(function (row) {
      return {
        ID: row.ID,
        ID_Curso: row.ID_Curso,
        Nombre: row.Nombre,
        Correo: row.Correo,
        Rol: row.Rol
      };
    });
  const cycles = Array.from(new Set(courses.map(function (course) {
    return course.Ciclo_Escolar;
  }).filter(Boolean))).sort();

  return {
    success: true,
    session: {
      user: session.user,
      role: session.role,
      isAdmin: session.isAdmin
    },
    cycles: cycles,
    courses: courses,
    students: students,
    roles: roles
  };
}

function getAttendanceMatrix_(session, cicloEscolar, idCurso) {
  const cycle = String(cicloEscolar || "").trim();
  const courseId = normalizarId_(idCurso);
  if (!cycle || !courseId) {
    throw new Error("Se requieren cicloEscolar e idCurso.");
  }
  requireCourseAccess_(session, courseId);

  const courseRows = readRows_("Course").filter(function (row) {
    return normalizarId_(row.ID_Curso) === courseId;
  });
  const conflictingCycles = Array.from(new Set(courseRows.map(function (row) {
    return String(row.Ciclo_Escolar || "").trim();
  })));
  if (conflictingCycles.length > 1) {
    throw new Error(
      "ID_Curso " + courseId + " aparece en varios ciclos. Asigne un ID_Curso único a cada curso/ciclo."
    );
  }

  const course = courseRows.filter(function (row) {
    return String(row.Ciclo_Escolar || "").trim() === cycle && isActive_(row.Activo);
  })[0];
  if (!course) {
    throw new Error("No existe un curso activo con ese ID_Curso y ciclo escolar.");
  }

  const students = readRows_("Students").filter(function (row) {
    return normalizarId_(row.Course) === courseId && normalizarId_(row.ID);
  });
  const studentsById = {};
  const studentIdsByAccount = {};
  students.forEach(function (student) {
    const studentId = normalizarId_(student.ID);
    if (!studentsById[studentId]) {
      studentsById[studentId] = {
        ID: student.ID,
        Cuenta: student.Cuenta,
        "First Name": student["First Name"],
        Email: student.Email,
        Course: student.Course
      };
    }
    const account = normalizarId_(student.Cuenta);
    if (account) {
      if (!studentIdsByAccount[account]) {
        studentIdsByAccount[account] = {};
      }
      studentIdsByAccount[account][studentId] = true;
    }
  });

  const attendanceRows = readRows_("Attendance Log");
  const attendanceKeys = new Set();
  const attendanceByAccountAndDate = {};
  const datesByIso = {};
  const warnings = [];
  attendanceRows.forEach(function (row) {
    if (normalizarId_(row.Course) !== courseId) {
      return;
    }

    const isoDate = aFechaISO_(row.Date);
    if (!isoDate) {
      warnings.push("Se omitió un registro del curso " + courseId + " con fecha no válida.");
      return;
    }

    const studentId = findStudentIdForLog_(row, studentsById, studentIdsByAccount);
    if (!studentId) {
      return;
    }

    const state = normalizarEstadoAsistencia_(row.Estado);
    if (!state) {
      warnings.push("Se omitió un registro del curso " + courseId + " con un Estado no reconocido.");
      return;
    }

    datesByIso[isoDate] = true;
    const account = normalizarId_(studentsById[studentId].Cuenta);
    const key = account + "|" + isoDate;
    attendanceKeys.add(key);
    if (!attendanceByAccountAndDate[key]) {
      attendanceByAccountAndDate[key] = {
        estado: state,
        presente: state === "Asistencia",
        justificada: state === "Justificada",
        hora: state === "Asistencia" ? normalizarHora_(row.Time) : "",
        logId: String(row.id || "")
      };
    }
  });

  const dates = Object.keys(datesByIso).sort().map(function (iso) {
    return { iso: iso, label: isoToLabel_(iso) };
  });
  const matrixStudents = Object.keys(studentsById).map(function (studentId) {
    const student = studentsById[studentId];
    const attendance = dates.map(function (date) {
      const key = normalizarId_(student.Cuenta) + "|" + date.iso;
      const details = attendanceByAccountAndDate[key];
      return attendanceKeys.has(key) && details
        ? details
        : {
          estado: "Falta",
          presente: false,
          justificada: false,
          hora: "",
          logId: ""
        };
    });
    const totalAttendance = attendance.filter(function (status) {
      return status.estado === "Asistencia";
    }).length;
    const totalAbsences = attendance.filter(function (status) {
      return status.estado === "Falta";
    }).length;
    const totalJustified = attendance.filter(function (status) {
      return status.estado === "Justificada";
    }).length;
    const eligibleDays = attendance.length - totalJustified;

    return {
      ID: student.ID,
      Cuenta: student.Cuenta,
      "First Name": student["First Name"],
      Email: student.Email,
      Course: student.Course,
      asistencias: totalAttendance,
      faltas: totalAbsences,
      justificadas: totalJustified,
      porcentaje: attendance.length
        ? (eligibleDays
          ? Math.round((totalAttendance / eligibleDays) * 10000) / 100
          : 100)
        : 0,
      estados: attendance
    };
  }).sort(function (left, right) {
    return String(left["First Name"] || "").localeCompare(String(right["First Name"] || ""));
  });

  return {
    success: true,
    course: {
      ID_Curso: course.ID_Curso,
      "Nombre Curso": course["Nombre Curso"],
      Grupo: course.Grupo,
      Horario: course.Horario,
      Ciclo_Escolar: course.Ciclo_Escolar
    },
    dates: dates,
    students: matrixStudents,
    warnings: Array.from(new Set(warnings))
  };
}

function saveAttendanceChanges_(session, payload) {
  const courseId = normalizarId_(payload.idCurso);
  const cycle = String(payload.cicloEscolar || "").trim();
  const changes = payload.changes;
  if (!courseId || !cycle || !Array.isArray(changes) || !changes.length) {
    throw new Error("Se requieren idCurso, cicloEscolar y al menos un cambio.");
  }
  if (changes.length > 500) {
    throw new Error("Guarda como máximo 500 cambios por solicitud.");
  }
  requireCourseAccess_(session, courseId);

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const matrix = getAttendanceMatrix_(session, cycle, courseId);
    const studentsById = {};
    const studentIdsByAccount = {};
    matrix.students.forEach(function (student) {
      const studentId = normalizarId_(student.ID);
      studentsById[studentId] = student;
      const account = normalizarId_(student.Cuenta);
      if (account) {
        if (!studentIdsByAccount[account]) {
          studentIdsByAccount[account] = {};
        }
        studentIdsByAccount[account][studentId] = true;
      }
    });

    const seenChanges = {};
    const normalizedChanges = changes.map(function (change) {
      const studentId = normalizarId_(change.idEstudiante);
      const student = studentsById[studentId];
      const isoDate = aFechaISO_(change.fecha);
      const requestedState = String(change.estado || "").trim();
      const state = normalizarEstadoAsistencia_(change.estado);
      if (!student || !isoDate || !requestedState || !state) {
        throw new Error("Cada cambio debe identificar un alumno inscrito, una fecha válida y un estado permitido.");
      }
      const key = studentId + "|" + isoDate;
      if (seenChanges[key]) {
        throw new Error("La solicitud contiene cambios duplicados para un mismo alumno y fecha.");
      }
      seenChanges[key] = true;
      return {
        key: key,
        studentId: studentId,
        student: student,
        isoDate: isoDate,
        estado: state
      };
    });

    const attendanceSheet = getSpreadsheet_().getSheetByName("Attendance Log");
    const existingRows = readRowsWithRowNumbers_("Attendance Log");
    const rowsByStudentAndDate = {};
    existingRows.forEach(function (entry) {
      const row = entry.record;
      if (normalizarId_(row.Course) !== courseId) {
        return;
      }
      const isoDate = aFechaISO_(row.Date);
      const studentId = findStudentIdForLog_(row, studentsById, studentIdsByAccount);
      if (!isoDate || !studentId) {
        return;
      }
      const key = studentId + "|" + isoDate;
      if (!rowsByStudentAndDate[key]) {
        rowsByStudentAndDate[key] = [];
      }
      rowsByStudentAndDate[key].push(entry);
    });

    const accountNumberByStudent = {};
    normalizedChanges.forEach(function (change) {
      const account = normalizarId_(change.student.Cuenta);
      const accountNumber = Number(account);
      if (!/^\d{9}$/.test(account) || !Number.isSafeInteger(accountNumber)) {
        throw new Error("La Cuenta del alumno debe contener exactamente nueve dígitos.");
      }
      accountNumberByStudent[change.studentId] = accountNumber;
    });
    const courseNumber = Number(courseId);
    if (!/^\d+$/.test(courseId) || !Number.isSafeInteger(courseNumber)) {
      throw new Error("ID_Curso debe ser un código numérico seguro para almacenarse en Sheets.");
    }

    const spreadsheet = getSpreadsheet_();
    const timeZone = spreadsheet.getSpreadsheetTimeZone();
    const currentTime = Utilities.formatDate(new Date(), timeZone, "HH:mm:ss");
    const currentTimeValue = Utilities.parseDate(currentTime, timeZone, "HH:mm:ss");
    const rowsToUpdate = [];
    const rowsToDelete = [];
    const rowsToAppend = [];
    const usedIds = existingRows.map(function (entry) {
      return entry.record;
    });

    normalizedChanges.forEach(function (change) {
      const matches = rowsByStudentAndDate[change.key] || [];
      const existing = matches.length ? matches[0] : null;
      const dateValue = Utilities.parseDate(change.isoDate, timeZone, "yyyy-MM-dd");
      let timeValue = "";
      if (change.estado === "Asistencia") {
        const existingTime = existing ? normalizarHora_(existing.record.Time) : "";
        timeValue = existingTime
          ? Utilities.parseDate(existingTime, timeZone, "HH:mm:ss")
          : currentTimeValue;
      }
      const id = existing && existing.record.id
        ? String(existing.record.id)
        : createUniqueLogId_(usedIds.concat(rowsToAppend.map(function (row) {
          return { id: row[0] };
        })));
      const values = [
        id,
        String(change.student.ID),
        accountNumberByStudent[change.studentId],
        courseNumber,
        dateValue,
        timeValue,
        change.estado
      ];

      if (existing) {
        rowsToUpdate.push({ rowNumber: existing.rowNumber, values: values });
        matches.slice(1).forEach(function (duplicate) {
          rowsToDelete.push(duplicate.rowNumber);
        });
      } else {
        rowsToAppend.push(values);
      }
    });

    rowsToUpdate.forEach(function (update) {
      attendanceSheet.getRange(update.rowNumber, 1, 1, 7).setValues([update.values]);
      attendanceSheet.getRange(update.rowNumber, 5).setNumberFormat("dd/MM/yyyy");
      attendanceSheet.getRange(update.rowNumber, 6).setNumberFormat("HH:mm:ss");
    });
    rowsToDelete.sort(function (left, right) {
      return right - left;
    }).forEach(function (rowNumber) {
      attendanceSheet.deleteRow(rowNumber);
    });
    rowsToAppend.forEach(function (values) {
      const newRow = Math.max(attendanceSheet.getLastRow() + 1, 2);
      attendanceSheet.getRange(newRow, 1, 1, 7).setValues([values]);
      attendanceSheet.getRange(newRow, 5).setNumberFormat("dd/MM/yyyy");
      attendanceSheet.getRange(newRow, 6).setNumberFormat("HH:mm:ss");
    });

    return {
      success: true,
      savedCount: normalizedChanges.length,
      message: normalizedChanges.length + " cambios de asistencia guardados."
    };
  } finally {
    lock.releaseLock();
  }
}

function generateReport_(session, payload) {
  const courseId = normalizarId_(payload.idCurso);
  const cycle = String(payload.cicloEscolar || "").trim();
  if (!courseId || !cycle) {
    throw new Error("Se requieren idCurso y cicloEscolar para generar el reporte.");
  }
  requireCourseAccess_(session, courseId);

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const matrix = getAttendanceMatrix_(session, cycle, courseId);
    const course = readRows_("Course").filter(function (row) {
      return normalizarId_(row.ID_Curso) === courseId &&
        String(row.Ciclo_Escolar || "").trim() === cycle;
    })[0];
    if (!course) {
      throw new Error("No se encontró el curso seleccionado para generar el reporte.");
    }

    const requestedName = String(course.Hoja_Reporte || "").trim();
    const reportName = requestedName || "Reporte_" + courseId;
    if (!/reporte/i.test(reportName)) {
      throw new Error("El nombre de la hoja de reporte debe contener la palabra Reporte.");
    }
    if (reportName.length > 100 || /[\\/?*:[\]]/.test(reportName)) {
      throw new Error("El nombre de la hoja de reporte no es válido para Google Sheets.");
    }

    const reportNameKey = reportName.toLowerCase();
    const duplicateName = readRows_("Course").some(function (row) {
      return normalizarId_(row.ID_Curso) !== courseId &&
        String(row.Hoja_Reporte || "").trim().toLowerCase() === reportNameKey;
    });
    if (duplicateName) {
      throw new Error("Otra fila de Course ya utiliza ese nombre de hoja de reporte.");
    }

    const dateIndexes = matrix.dates.map(function (date, index) {
      return index;
    }).filter(function (dateIndex) {
      return matrix.students.some(function (student) {
        return student.estados[dateIndex] && student.estados[dateIndex].presente;
      });
    });
    const headers = [
      "ID estudiante",
      "Cuenta",
      "Alumno",
      "Asistencias",
      "Faltas",
      "Justificadas",
      "% Asistencia"
    ].concat(dateIndexes.map(function (dateIndex) {
      return matrix.dates[dateIndex].label;
    }));
    const values = [headers];
    const backgrounds = [headers.map(function () {
      return "#000000";
    })];

    matrix.students.forEach(function (student) {
      const attendanceValues = dateIndexes.map(function (dateIndex) {
        return student.estados[dateIndex].estado;
      });
      values.push([
        String(student.ID || ""),
        student.Cuenta,
        String(student["First Name"] || ""),
        student.asistencias,
        student.faltas,
        student.justificadas,
        student.porcentaje / 100
      ].concat(attendanceValues));
      backgrounds.push([
        "#ffffff",
        "#ffffff",
        "#ffffff",
        "#ffffff",
        "#ffffff",
        "#ffffff",
        "#ffffff"
      ].concat(attendanceValues.map(function (status) {
        if (status === "Asistencia") {
          return "#d1e7dd";
        }
        return status === "Justificada" ? "#dceaf2" : "#f8d7da";
      })));
    });

    const spreadsheet = getSpreadsheet_();
    let reportSheet = spreadsheet.getSheetByName(reportName);
    if (!reportSheet) {
      reportSheet = spreadsheet.insertSheet(reportName);
    }

    const oldLastRow = reportSheet.getLastRow();
    const oldLastColumn = reportSheet.getLastColumn();
    const clearRows = Math.max(oldLastRow, values.length);
    const clearColumns = Math.max(oldLastColumn, headers.length);
    if (reportSheet.getMaxRows() < values.length) {
      reportSheet.insertRowsAfter(
        reportSheet.getMaxRows(),
        values.length - reportSheet.getMaxRows()
      );
    }
    if (reportSheet.getMaxColumns() < headers.length) {
      reportSheet.insertColumnsAfter(
        reportSheet.getMaxColumns(),
        headers.length - reportSheet.getMaxColumns()
      );
    }
    if (clearRows && clearColumns) {
      reportSheet.getRange(1, 1, clearRows, clearColumns).clear();
    }

    const reportRange = reportSheet.getRange(1, 1, values.length, headers.length);
    reportRange.setValues(values);
    reportRange.setBackgrounds(backgrounds);
    reportSheet.getRange(1, 1, 1, headers.length)
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    if (values.length > 1) {
      reportSheet.getRange(2, 7, values.length - 1, 1).setNumberFormat("0.00%");
    }
    const removedEmptyDateColumns = removeDateColumnsWithoutAttendance_(reportSheet, 8);
    const staleColumns = oldLastColumn - headers.length;
    if (staleColumns > 0) {
      reportSheet.deleteColumns(headers.length + 1, staleColumns);
    }
    reportSheet.setFrozenRows(1);
    reportSheet.autoResizeColumns(1, reportSheet.getLastColumn());

    return {
      success: true,
      sheetName: reportName,
      studentCount: matrix.students.length,
      dateColumnCount: reportSheet.getLastColumn() - 7,
      removedAllAbsenceDateColumns: matrix.dates.length - dateIndexes.length +
        removedEmptyDateColumns + Math.max(staleColumns, 0),
      message: "Reporte generado o actualizado en la hoja " + reportName + "."
    };
  } finally {
    lock.releaseLock();
  }
}

function removeDateColumnsWithoutAttendance_(sheet, firstDateColumn) {
  const lastColumn = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  if (lastColumn < firstDateColumn) {
    return 0;
  }

  const dateColumnCount = lastColumn - firstDateColumn + 1;
  const columnsWithAttendance = [];
  if (lastRow > 1) {
    const values = sheet.getRange(
      2,
      firstDateColumn,
      lastRow - 1,
      dateColumnCount
    ).getDisplayValues();
    for (let columnOffset = 0; columnOffset < dateColumnCount; columnOffset += 1) {
      const containsAttendance = values.some(function (row) {
        return /asistencia/i.test(String(row[columnOffset] || ""));
      });
      if (containsAttendance) {
        columnsWithAttendance.push(firstDateColumn + columnOffset);
      }
    }
  }

  const columnsToDelete = [];
  for (let column = firstDateColumn; column <= lastColumn; column += 1) {
    if (columnsWithAttendance.indexOf(column) === -1) {
      columnsToDelete.push(column);
    }
  }
  columnsToDelete.sort(function (left, right) {
    return right - left;
  }).forEach(function (column) {
    sheet.deleteColumn(column);
  });
  return columnsToDelete.length;
}

function readRows_(sheetName) {
  return readRowsWithRowNumbers_(sheetName).map(function (entry) {
    return entry.record;
  });
}

function readRowsWithRowNumbers_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("No existe la hoja requerida: " + sheetName + ". Ejecute setupDatabase().");
  }

  const table = DATABASE_SCHEMA_.filter(function (item) {
    return item.name === sheetName;
  })[0];
  if (!table) {
    throw new Error("No existe una definición de tabla para la hoja: " + sheetName + ".");
  }
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map(function (value) {
    return String(value || "").trim();
  });
  table.headers.forEach(function (header) {
    if (headers.indexOf(header) === -1) {
      throw new Error(
        "Encabezado faltante en " + sheetName + ": " + header + ". Ejecute setupDatabase()."
      );
    }
  });

  return values.slice(1).map(function (row, index) {
    const record = {};
    table.headers.forEach(function (header) {
      record[header] = row[headers.indexOf(header)];
    });
    return { rowNumber: index + 2, record: record };
  }).filter(function (entry) {
    return Object.keys(entry.record).some(function (header) {
      const value = entry.record[header];
      return value !== "" && value !== null;
    });
  });
}

function findStudentIdForLog_(logRow, studentsById, studentIdsByAccount) {
  const foreignKey = normalizarId_(logRow.fk_id_student);
  if (foreignKey && studentsById[foreignKey]) {
    return foreignKey;
  }

  const account = normalizarId_(logRow.Cuenta);
  const matchingIds = account ? studentIdsByAccount[account] : null;
  if (!matchingIds) {
    return "";
  }
  const ids = Object.keys(matchingIds);
  return ids.length === 1 ? ids[0] : "";
}

function requireSession_(token) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw new Error("Sesión no válida. Inicie sesión nuevamente.");
  }
  const serializedSession = CacheService.getScriptCache()
    .get(SESSION_CACHE_PREFIX_ + normalizedToken);
  if (!serializedSession) {
    throw new Error("La sesión expiró. Inicie sesión nuevamente.");
  }
  return JSON.parse(serializedSession);
}

function requireAdministrator_(session) {
  if (!session.isAdmin) {
    throw new Error("Esta acción requiere permisos de administrador.");
  }
}

function requireCourseAccess_(session, courseId) {
  if (!hasCourseAccess_(session, courseId)) {
    throw new Error("No tiene permisos para consultar o editar este curso.");
  }
}

function hasCourseAccess_(session, courseId) {
  return !!session.isAdmin ||
    (Array.isArray(session.courseIds) && session.courseIds.indexOf(courseId) !== -1);
}

function isActive_(value) {
  if (value === false || value === 0) {
    return false;
  }
  const normalized = String(value === null || value === undefined ? "" : value)
    .trim()
    .toLowerCase();
  return normalized !== "false" &&
    normalized !== "no" &&
    normalized !== "inactivo" &&
    normalized !== "0";
}

function isActiveRole_(value) {
  const role = String(value || "").trim().toLowerCase();
  return !!role && role !== "inactivo" && role !== "inactive" && role !== "false";
}

function normalizarId_(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return String(value).trim().replace(/\.0+$/, "").toUpperCase();
}

function normalizarEstadoAsistencia_(value) {
  const state = String(value || "").trim().toLowerCase();
  if (!state) {
    return "Asistencia";
  }
  if (state === "asistencia") {
    return "Asistencia";
  }
  if (state === "falta") {
    return "Falta";
  }
  if (state === "justificada") {
    return "Justificada";
  }
  return "";
}

function normalizeEmail_(value) {
  return String(value || "").trim().toLowerCase();
}

function aFechaISO_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(
      value,
      getSpreadsheet_().getSpreadsheetTimeZone(),
      "yyyy-MM-dd"
    );
  }
  if (typeof value !== "string") {
    return "";
  }

  const input = value.trim();
  let match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  if (match) {
    return makeIsoDate_(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return makeIsoDate_(Number(match[3]), Number(match[2]), Number(match[1]));
  }
  return "";
}

function makeIsoDate_(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) {
    return "";
  }
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function isoToLabel_(iso) {
  const parts = iso.split("-");
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function normalizarHora_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(
      value,
      getSpreadsheet_().getSpreadsheetTimeZone(),
      "HH:mm:ss"
    );
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const totalSeconds = Math.round((value % 1) * 86400);
    const hour = Math.floor(totalSeconds / 3600) % 24;
    const minute = Math.floor((totalSeconds % 3600) / 60);
    const second = totalSeconds % 60;
    return [hour, minute, second].map(function (part) {
      return String(part).padStart(2, "0");
    }).join(":");
  }

  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return "";
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) {
    return "";
  }
  return [hour, minute, second].map(function (part) {
    return String(part).padStart(2, "0");
  }).join(":");
}

function createUniqueLogId_(existingRows) {
  const existingIds = {};
  existingRows.forEach(function (row) {
    existingIds[String(row.id || "").toLowerCase()] = true;
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = Utilities.getUuid().replace(/-/g, "").slice(0, 8).toLowerCase();
    if (!existingIds[candidate]) {
      return candidate;
    }
  }
  throw new Error("No se pudo generar un identificador de asistencia único.");
}

function getSpreadsheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("No se encontró el libro de Google Sheets vinculado al proyecto.");
  }
  return spreadsheet;
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function logApiError_(error) {
  console.error(error && error.stack ? error.stack : String(error));
}
