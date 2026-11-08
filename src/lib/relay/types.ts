/** Lo que cada Tasky de escritorio publica para que el celular lo vea. */
export interface DeviceSnapshot {
  v: 1;
  id: string;
  name: string;
  updated_at: string;
  statuses: { id: string; name: string; symbol: string; color: string; sort_order: number; is_done: boolean }[];
  projects: { id: string; name: string; sort_order: number }[];
  /** Solo tareas sin terminar de proyectos no archivados. Sin notas. */
  tasks: {
    id: string;
    project_id: string;
    title: string;
    status_id: string;
    priority: number;
    due_date: string | null;
    tags: string[];
    sort_order: number;
  }[];
}

/** Nota que el celular envía a un equipo. */
export interface OutgoingNote {
  text: string;
  deviceId: string;
  deviceName: string;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
}

/** Nota pendiente de entrega, tal como está en la bandeja. */
export interface InboxNote extends OutgoingNote {
  number: number;
}

/** Bandeja compartida entre el celular y los equipos. */
export interface Relay {
  /** Comprueba que el repo existe y el token tiene acceso. */
  checkAccess(): Promise<void>;
  listDevices(): Promise<DeviceSnapshot[]>;
  publishDevice(snapshot: DeviceSnapshot): Promise<void>;
  sendNote(note: OutgoingNote): Promise<number>;
  /** Notas sin entregar; si se indica equipo, solo las de ese equipo. */
  listNotes(deviceId?: string): Promise<InboxNote[]>;
  /** Marca la nota como entregada (la cierra con un comentario). */
  ackNote(number: number, message: string): Promise<void>;
}

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}
