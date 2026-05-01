-- Admin: dos claves validas a la vez (admin123 y lucas123), mismos hashes scrypt que el servidor.
-- Ejecuta todo en SQL Editor. Si la tabla ya existia sin columnas _b, las agrega.

create table if not exists admin_credential (
  id integer primary key check (id = 1),
  password_salt text not null,
  password_hash text not null,
  password_salt_b text,
  password_hash_b text,
  actualizado_en text not null
);

alter table admin_credential disable row level security;

alter table admin_credential add column if not exists password_salt_b text;
alter table admin_credential add column if not exists password_hash_b text;

-- Una fila: slot principal = admin123, slot secundario = lucas123
insert into admin_credential (
  id,
  password_salt,
  password_hash,
  password_salt_b,
  password_hash_b,
  actualizado_en
)
values (
  1,
  '01010101010101010101010101010101',
  'c88fd92c16975b585a278a41d263f42c8adb1102d952ae380de0deb82f6b2e3a649f4384e83b858736d4cc1e19b12c1df4dfd7abfb0d919cadcd7f56eae342b4',
  '02020202020202020202020202020202',
  'b499786dabf052d97c4a48218cef8aa87796542f88135da573d146f5ea9bc6f5914b577792d222893c686be1f7356a7c27768bfd5c6b3f3659f649cb90c3be82',
  now()
)
on conflict (id) do update set
  password_salt = excluded.password_salt,
  password_hash = excluded.password_hash,
  password_salt_b = excluded.password_salt_b,
  password_hash_b = excluded.password_hash_b,
  actualizado_en = excluded.actualizado_en;
