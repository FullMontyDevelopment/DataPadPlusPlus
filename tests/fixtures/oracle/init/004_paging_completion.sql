-- Metadata-only stress objects for Oracle Explorer and IntelliSense paging.
-- 125 tables x 18 columns guarantees more than 100 tables and 2,000 columns
-- without adding row volume or making ordinary query fixtures slower.
declare
  table_name varchar2(128);
  column_list varchar2(32767) := 'id number not null';
begin
  for column_number in 1..17 loop
    column_list := column_list
      || ', paging_value_'
      || lpad(to_char(column_number), 2, '0')
      || ' varchar2(64)';
  end loop;

  for table_number in 1..125 loop
    table_name := 'DPP_PAGING_TABLE_' || lpad(to_char(table_number), 3, '0');
    begin
      execute immediate 'create table ' || table_name || ' (' || column_list || ')';
    exception
      when others then
        if sqlcode != -955 then raise; end if;
    end;
  end loop;
end;
/

begin
  execute immediate 'create table DPP_CASE_TABLE (id number, upper_value varchar2(64))';
exception
  when others then
    if sqlcode != -955 then raise; end if;
end;
/

begin
  execute immediate 'create table "Dpp_Case_Table" (id number, "MixedCaseColumn" varchar2(64))';
exception
  when others then
    if sqlcode != -955 then raise; end if;
end;
/

begin
  execute immediate 'create table "Dpp$Quoted#Table" (id number, "Mixed$Column#" varchar2(64))';
exception
  when others then
    if sqlcode != -955 then raise; end if;
end;
/

begin
  execute immediate 'create table "Dpp_販売_Table" (id number, "説明" varchar2(64))';
exception
  when others then
    if sqlcode != -955 then raise; end if;
end;
/

commit;
