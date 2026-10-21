#!/bin/sh
# The image passes .iql files to one `influx -execute` call, which cannot
# reliably mix database statements, blank lines, and INSERT shell commands.
influx -host 127.0.0.1 -port 8086 -import -path=/docker-entrypoint-initdb.d/seed.lp -precision=ns
