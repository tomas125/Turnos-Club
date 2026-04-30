-- Tabla de reservas
create table if not exists reservas (
  id bigserial primary key,
  nombre text not null,
  telefono text not null,
  cancha integer not null,
  fecha text not null,
  horario text not null,
  comprobante_nombre_original text not null,
  comprobante_archivo text not null,
  comprobante_mimetype text not null,
  comprobante_size integer not null,
  creado_en text not null
);

-- Tabla de bloqueos
create table if not exists bloqueos (
  id bigserial primary key,
  cancha integer not null,
  fecha text not null,
  horario text,
  horario_desde text,
  horario_hasta text,
  dia_completo boolean not null default false,
  motivo text not null,
  creado_en text not null
);

-- RLS: deshabilitar (la app usa service key, acceso controlado desde el backend)
alter table reservas disable row level security;
alter table bloqueos disable row level security;
