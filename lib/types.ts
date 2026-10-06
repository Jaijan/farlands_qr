export type Staff = {
  id: string;
  name: string;
  username: string;
  role: 'admin' | 'volunteer';
  assigned_exit: 'exit_1' | 'exit_2' | null;
  active: boolean;
};
export type Participant = {
  id: string;
  participant_code: string;
  name: string;
  phone: string;
  email: string;
  team_name: string;
  college_name: string;
  alternate_contact: string;
  status: 'inside' | 'outside' | 'suspended';
  created_at: string;
};
export type ExitSession = {
  id: string;
  participant_id: string;
  exit_id: string;
  return_exit_id: string | null;
  exited_at: string;
  returned_at: string | null;
  duration_seconds: number | null;
  status: string;
  return_method: string | null;
};
export type Snapshot = {
  participants: Participant[];
  sessions: ExitSession[];
  staff: Staff;
  server_time: string;
  registration_open: boolean;
  gates: { exit_id: string; last_seen_at: string; active: boolean }[];
};
