// D42: the interface texts in es-MX, in one module and with no i18n library.
// It holds every text of the screens moved here so far (login, the app
// metadata, dashboard, profile, employee list and detail, the employee
// history, org chart and MFA enrollment) and the label of every enum created
// in supabase/migrations. Other screens move in when they are next touched.
// Stored enum values (ACTIVE, ON_TRACK…) never change: they are translated
// only when shown, with enumLabel().

export const messages = {
  common: {
    empty: "—",
    noJob: "Sin puesto",
    noJobAssigned: "Sin puesto asignado",
    noDepartment: "Sin departamento",
  },
  app: {
    name: "Scalia HR",
    tagline: "Gestión de capital humano",
  },
  fields: {
    fullName: "Nombre completo",
    firstName: "Nombre",
    lastName: "Apellido",
    email: "Correo electrónico",
    personalEmail: "Correo personal",
    employeeNumber: "Número de empleado",
    status: "Estado",
    hireDate: "Fecha de ingreso",
    jobTitle: "Puesto",
    position: "Posición",
    department: "Departamento",
    classification: "Clasificación",
    manager: "Jefe directo",
    noManager: "Sin jefe directo",
    location: "Ubicación",
    businessUnit: "Unidad de negocio",
    legalEntity: "Entidad legal",
    effectiveDate: "Fecha efectiva",
    reason: "Motivo",
    phone: "Teléfono",
    nationality: "Nacionalidad",
    birthDate: "Fecha de nacimiento",
    birth: "Nacimiento",
    gender: "Género",
    maritalStatus: "Estado civil",
    nationalId: "CURP / ID nacional",
    taxId: "RFC",
    imss: "IMSS",
    street: "Calle",
    street2: "Calle 2",
    city: "Ciudad",
    state: "Estado",
    postalCode: "C.P.",
    country: "País",
    baseSalary: "Salario base",
    currency: "Moneda",
    frequency: "Frecuencia",
    payFrequency: "Frecuencia de pago",
    bonusTarget: "Bono objetivo",
    payGroup: "Grupo de pago",
    title: "Título",
  },
  login: {
    heading: "Inicia sesión en tu cuenta",
    companyCode: "Código de empresa (opcional)",
    companyCodePlaceholder: "acme-corp",
    email: "Correo electrónico",
    emailPlaceholder: "tu@empresa.com",
    password: "Contraseña",
    passwordPlaceholder: "••••••••",
    submit: "Iniciar sesión",
    submitting: "Iniciando sesión…",
    genericError: "No se pudo iniciar sesión. Intenta de nuevo.",
    demoHint: (hint: string) => `Demo: ${hint}`,
  },
  mfaEnroll: {
    factorName: "App de autenticación",
    heading: "Configurar autenticación de dos factores",
    intro: "Escanea el código QR con tu aplicación de autenticación (Google Authenticator, Authy, 1Password, etc.)",
    qrAlt: "Código QR",
    manualEntry: "Si no puedes escanear, ingresa manualmente:",
    code: "Código de verificación",
    submit: "Activar MFA",
    submitting: "Verificando…",
  },
  dashboard: {
    noProfile: "No se encontró perfil de usuario. Contacte al administrador.",
    welcome: (name: string) => `Bienvenido, ${name}`,
    activeEmployees: "Empleados Activos",
    departments: "Departamentos",
    performanceScore: "Calificación de desempeño",
    potentialScore: "Calificación de potencial",
    myInformation: "Mi Información",
    myGoals: "Mis Objetivos (PMGM)",
    noGoals: "No hay objetivos registrados aún.",
  },
  profile: {
    noProfile: "No se encontró perfil de usuario.",
    heading: "Mi Perfil",
    subheading: "Información personal y profesional",
    personalData: "Datos Personales",
    jobInformation: "Información del Puesto",
    talentReview: "Revisión de talento (9-Box)",
    performance: "Desempeño",
    potential: "Potencial",
    feedbackReceived: "Feedback Recibido",
    noFeedback: "No hay feedback registrado.",
  },
  employees: {
    heading: "Empleados",
    subheading: "Directorio de empleados activos",
    searchPlaceholder: "Buscar por nombre, correo o número de empleado…",
    loadError: "No se pudo cargar la lista de empleados.",
    columns: {
      employee: "Empleado",
      jobTitle: "Puesto",
      department: "Departamento",
      employeeNumber: "Número de empleado",
      status: "Estado",
    },
    noResultsFor: (search: string) => `No se encontraron empleados para "${search}".`,
    none: "No hay empleados registrados.",
    viewProfile: "Ver perfil →",
    showing: (from: number, to: number, total: number) => `Mostrando ${from}–${to} de ${total}`,
    previous: "← Anterior",
    next: "Siguiente →",
  },
  employeeDetail: {
    personalInformation: "Información Personal",
    address: "Dirección",
    emergencyContact: "Contacto de emergencia",
    noPersonalInformation: "Sin información personal registrada.",
    jobInformation: "Información Laboral",
    noJobInformation: "Sin información laboral registrada.",
    compensation: "Compensación",
    noCompensation: "Sin información de compensación registrada.",
    historyOf: {
      personal: "información personal",
      job: "información laboral",
      compensation: "compensación",
    },
  },
  history: {
    show: (subject: string, count: number) => `Ver historial de ${subject} (${count} registros)`,
    current: "Vigente",
  },
  orgChart: {
    heading: "Organigrama — Gestión de posiciones",
    summary: (positions: number, vacant: number) =>
      `Estructura jerárquica basada en posiciones (${positions} posiciones, ${vacant} vacantes)`,
    empty: "No hay datos de organigrama disponibles.",
    vacant: "Vacante",
    toBeHired: "Por contratar",
  },
} as const;

/** Labels of every enum created in supabase/migrations, keyed by the enum's name. */
export const ENUM_LABELS = {
  EmployeeStatus: { ACTIVE: "Activo", INACTIVE: "Inactivo", ON_LEAVE: "Con permiso", TERMINATED: "Baja" },
  // Goals are "objetivos" in the interface, so their states agree with that noun.
  GoalStatus: {
    NOT_STARTED: "Sin iniciar",
    ON_TRACK: "En curso",
    AT_RISK: "En riesgo",
    COMPLETED: "Completado",
    CANCELLED: "Cancelado",
  },
  FeedbackVisibility: { PRIVATE: "Privado", MANAGER_ONLY: "Solo jefe directo", PUBLIC: "Público" },
  FeedbackCategory: { GENERAL: "General", RECOGNITION: "Reconocimiento", COACHING: "Coaching", DEVELOPMENT: "Desarrollo" },
  TalentPoolType: {
    LEADERSHIP: "Liderazgo",
    HIGH_POTENTIAL: "Alto potencial",
    CRITICAL_ROLE: "Rol crítico",
    EMERGING_TALENT: "Talento emergente",
    CUSTOM: "Personalizado",
  },
  ReadinessLevel: { READY_NOW: "Listo ahora", READY_1_YEAR: "Listo en 1 año", READY_2_YEARS: "Listo en 2 años", NOT_READY: "No listo" },
  PlanCriticality: { LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" },
  PlanStatus: { DRAFT: "Borrador", ACTIVE: "Activo", ARCHIVED: "Archivado" },
  SkillCategory: {
    TECHNICAL: "Técnica",
    LEADERSHIP: "Liderazgo",
    FUNCTIONAL: "Funcional",
    INTERPERSONAL: "Interpersonal",
    LANGUAGE: "Idioma",
    CERTIFICATION: "Certificación",
  },
  SkillImportance: { CRITICAL: "Crítica", REQUIRED: "Requerida", PREFERRED: "Preferente", NICE_TO_HAVE: "Deseable" },
  pay_frequency: { monthly: "Mensual", biweekly: "Quincenal", weekly: "Semanal", annual: "Anual" },
  arco_request_type: { acceso: "Acceso", rectificacion: "Rectificación", cancelacion: "Cancelación", oposicion: "Oposición" },
  arco_request_status: { pending: "Pendiente", in_progress: "En proceso", completed: "Completada", rejected: "Rechazada" },
  target_population_type: { all: "Todos", same_department: "Mismo departamento", direct_reports: "Reportes directos", self: "Uno mismo" },
  rbp_action: { view: "Ver", edit: "Editar" },
} as const;

export type EnumName = keyof typeof ENUM_LABELS;

/** The label of a stored enum value; an unknown value is shown as it is, and a missing one as "—". */
export function enumLabel(enumName: EnumName, value: string | null | undefined): string {
  if (value == null || value === "") return messages.common.empty;
  const labels: Readonly<Record<string, string>> = ENUM_LABELS[enumName];
  return labels[value] ?? value;
}
