-- Credencial admin (hash scrypt, mismos parametros que server/index.js).
-- Ejecuta TODO este script en SQL Editor (crea la tabla si no existe y luego inserta).
-- Solo puede haber UNA fila (id = 1). Cada bloque INSERT hace upsert por id.
--
-- Si dejas solo el primer INSERT activo -> admin123
-- Si ejecutas ambos INSERT seguidos -> queda lucas123 (el segundo pisa al primero).

create table if not exists admin_credential (
  id integer primary key check (id = 1),
  password_salt text not null,
  password_hash text not null,
  actualizado_en text not null
);

alter table admin_credential disable row level security;

-- ========== Clave admin123 ==========
insert into admin_credential (id, password_salt, password_hash, actualizado_en)
values (
  1,
  '01010101010101010101010101010101',
  'c88fd92c16975b585a278a41d263f42c8adb1102d952ae380de0deb82f6b2e3a649f4384e83b858736d4cc1e19b12c1df4dfd7abfb0d919cadcd7f56eae342b4',
  now()
)
on conflict (id) do update set
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  actualizado_en = excluded.actualizado_en;

-- ========== Clave lucas123 ==========
insert into admin_credential (id, password_salt, password_hash, actualizado_en)
values (
  1,
  '02020202020202020202020202020202',
  'b499786dabf052d97c4a48218cef8aa87796542f88135da573d146f5ea9bc6f5914b577792d222893c686be1f7356a7c27768bfd5c6b3f3659f649cb90c3be82',
  now()
)
on conflict (id) do update set
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  actualizado_en = excluded.actualizado_en;
