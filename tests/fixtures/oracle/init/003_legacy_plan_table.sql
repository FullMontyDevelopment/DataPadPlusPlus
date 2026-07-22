declare
  plan_table_count number;
  other_tag_count number;
begin
  select count(*)
  into plan_table_count
  from user_tables
  where table_name = 'PLAN_TABLE';

  if plan_table_count = 0 then
    execute immediate q'~
      create table plan_table (
        statement_id varchar2(30),
        plan_id number,
        timestamp date,
        remarks varchar2(4000),
        operation varchar2(30),
        options varchar2(255),
        object_node varchar2(128),
        object_owner varchar2(128),
        object_name varchar2(128),
        object_alias varchar2(261),
        object_instance number(38),
        object_type varchar2(30),
        optimizer varchar2(255),
        search_columns number,
        id number(38),
        parent_id number(38),
        depth number(38),
        position number(38),
        cost number(38),
        cardinality number(38),
        bytes number(38),
        partition_start varchar2(255),
        partition_stop varchar2(255),
        partition_id number(38),
        other long,
        other_xml clob,
        distribution varchar2(30),
        cpu_cost number(38),
        io_cost number(38),
        temp_space number(38),
        access_predicates varchar2(4000),
        filter_predicates varchar2(4000),
        projection varchar2(4000),
        time number(38),
        qblock_name varchar2(128)
      )~';
  end if;

  select count(*)
  into other_tag_count
  from user_tab_columns
  where table_name = 'PLAN_TABLE'
    and column_name = 'OTHER_TAG';

  if other_tag_count > 0 then
    execute immediate 'alter table plan_table drop column other_tag';
  end if;
end;
/
