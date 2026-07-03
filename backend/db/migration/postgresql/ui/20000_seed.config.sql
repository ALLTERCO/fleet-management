--------------UP
INSERT INTO ui.config (name, json) OVERRIDING SYSTEM VALUE VALUES
  ('node_red_enable', 'false');
--------------DOWN
DELETE FROM ui.config WHERE name = 'node_red_enable';
