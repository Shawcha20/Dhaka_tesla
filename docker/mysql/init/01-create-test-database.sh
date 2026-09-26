#!/bin/bash
# Runs once, when MySQL initialises an empty data directory.
#
# The integration suite needs a database of its own: it truncates every table
# between tests, and pointing that at the development database would wipe the
# seeded demo data on every run. TEST_DATABASE_URL in .env targets this schema.
#
# A shell script rather than a plain .sql file so the names come from the
# environment. Hardcoding the user would mean the GRANT silently stops matching
# the moment someone changes MYSQL_USER.
set -euo pipefail

TEST_DB="${MYSQL_DATABASE}_test"

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- The image grants MYSQL_USER rights on MYSQL_DATABASE only, so the test schema
-- has to be granted explicitly.
GRANT ALL PRIVILEGES ON \`${TEST_DB}\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL

echo "==> Created ${TEST_DB} and granted access to ${MYSQL_USER}"
