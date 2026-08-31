alter session set container = FREEPDB1;

begin
  execute immediate q'[create user datapad_restore identified by "datapad_restore"]';
exception
  when others then
    if sqlcode != -01920 then raise; end if;
end;
/

begin
  execute immediate q'[create user datapad_pump_source identified by "datapad_pump_source"]';
exception
  when others then
    if sqlcode != -01920 then raise; end if;
end;
/

grant create session, create table, create view, create sequence, create procedure, create trigger to datapad_restore;
alter user datapad_restore quota unlimited on users;
grant create session, create table to datapad_pump_source;
alter user datapad_pump_source quota unlimited on users;

begin
  execute immediate q'[
    create table datapad_pump_source.schema_transfer_data (
      id number primary key,
      payload varchar2(200),
      event_time timestamp with time zone
    )]';
exception
  when others then
    if sqlcode != -955 then raise; end if;
end;
/

merge into datapad_pump_source.schema_transfer_data target
using (
  select 1 id, 'schema-backup-室内' payload, timestamp '2026-08-31 12:30:45 UTC' event_time from dual
) source
on (target.id = source.id)
when matched then update set target.payload = source.payload, target.event_time = source.event_time
when not matched then insert (id, payload, event_time) values (source.id, source.payload, source.event_time);

commit;

grant execute on sys.dbms_datapump to datapadplusplus;
grant read, write on directory data_pump_dir to datapadplusplus;
grant datapump_exp_full_database, datapump_imp_full_database to datapadplusplus;
grant create table to datapadplusplus;
alter user datapadplusplus quota unlimited on users;

begin
  for object_row in (
    select object_name, object_type
    from all_objects
    where owner = 'DATAPAD_RESTORE'
      and object_name not like 'BIN$%'
      and object_type in ('TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'TRIGGER', 'TYPE')
    order by case object_type when 'TABLE' then 2 else 1 end, object_name
  ) loop
    begin
      execute immediate 'drop ' || object_row.object_type || ' datapad_restore."'
        || replace(object_row.object_name, '"', '""') || '"'
        || case when object_row.object_type = 'TABLE' then ' cascade constraints purge' else '' end;
    exception
      when others then null;
    end;
  end loop;
end;
/
