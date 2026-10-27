-- Base inicial de datos. Aplicar en una base de desarrollo Supabase/PostgreSQL.
-- Supabase Auth administra las identidades; public.profiles referencia auth.users.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  subject text not null default '',
  education_level text not null default '',
  learning_objectives jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','ready','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  prompt text not null,
  max_score numeric(8,2) not null default 10 check (max_score >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.rubrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete set null,
  name text not null,
  criteria jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  external_reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete restrict,
  question_id uuid references public.questions(id) on delete set null,
  student_id uuid references public.students(id) on delete set null,
  student_label text,
  response_text text not null,
  status text not null default 'pending' check (status in ('pending','processing','review','approved','failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  rubric_snapshot jsonb not null,
  ai_proposal jsonb,
  teacher_result jsonb,
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected')),
  provider text,
  model text,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create index if not exists idx_assessments_user_updated on public.assessments(user_id, updated_at desc);
create index if not exists idx_questions_assessment on public.questions(user_id, assessment_id, position);
create index if not exists idx_rubrics_user on public.rubrics(user_id, created_at desc);
create index if not exists idx_students_user on public.students(user_id, display_name);
create index if not exists idx_submissions_user_status on public.submissions(user_id, status, created_at desc);
create index if not exists idx_corrections_user on public.corrections(user_id, created_at desc);

-- RLS como defensa adicional. Las políticas deben validarse con las credenciales y el flujo elegidos.
alter table public.profiles enable row level security;
alter table public.assessments enable row level security;
alter table public.questions enable row level security;
alter table public.rubrics enable row level security;
alter table public.students enable row level security;
alter table public.submissions enable row level security;
alter table public.corrections enable row level security;

create policy "profiles own row" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "assessments own rows" on public.assessments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "questions own rows" on public.questions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "rubrics own rows" on public.rubrics for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "students own rows" on public.students for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "submissions own rows" on public.submissions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "corrections own rows" on public.corrections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
