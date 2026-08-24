"""Flip a freyacad row in FEATURE-MATRIX.html to done, recompute the tallies and
the cost total from the table itself, and print the new state.

    python dev/matrix_done.py "Shell" "optional note shown beside the tick"

Run it from anywhere; it finds the matrix relative to this file. The tallies and
the "~N.NNM output tokens over N items" line are recomputed from the table rather
than edited by hand, so they cannot drift out of step with the ticks.
"""
import io, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
F = os.path.join(HERE, os.pardir, "FEATURE-MATRIX.html")

name = sys.argv[1]
note = sys.argv[2] if len(sys.argv) > 2 else ""
s = io.open(F, encoding="utf-8").read()

i = s.index('<span class="fname">%s</span>' % name)
j = s.index("</tr>", i)
row = s[i:j]

# the freyacad mark is the last col-mark in the row
marks = list(re.finditer(r'<td class="col-mark">.*?</td>', row, re.S))
last = marks[-1]
row = row[:last.start()] + \
      '<td class="col-mark"><span class="mk yes">✅</span>' + \
      (('<span class="q">%s</span>' % note) if note else '') + '</td>' + \
      row[last.end():]

# and its cost cell becomes a dash
row = re.sub(r'<td class="col-tok [^"]*">.*?</td>',
             '<td class="col-tok done">&mdash;</td>', row, flags=re.S)
s = s[:i] + row + s[j:]

# recompute from the table
body = s[s.index("<tbody>"):]
rows = re.findall(r'<tr>\s*<td class="col-feat">.*?</tr>', body, re.S)
assert len(rows) == 76, len(rows)
fy = [re.findall(r'class="mk (\w+)"', r)[-1] for r in rows]
tot = sum(int(x) for x in re.findall(r'class="num">(\d+)k<', s))
gaps = len(re.findall(r'class="num">\d+k<', s))
y, p, n = fy.count("yes"), fy.count("partial"), fy.count("no")

s = re.sub(r'(tcard fy.*?nums">)<b>\d+</b>(\s*✅\s*&nbsp;·&nbsp;\s*)<b>\d+</b>'
           r'(\s*◐\s*&nbsp;·&nbsp;\s*)<b>\d+</b>',
           lambda m: '%s<b>%d</b>%s<b>%d</b>%s<b>%d</b>' % (m.group(1), y, m.group(2), p, m.group(3), n),
           s, flags=re.S)
s = re.sub(r'<b>~[\d.]+M</b> output tokens &nbsp;·&nbsp; \d+ items',
           '<b>~%.2fM</b> output tokens &nbsp;·&nbsp; %d items' % (tot / 1000.0, gaps), s)

io.open(F, "w", encoding="utf-8", newline="").write(s)
print("%s -> done | freyacad %dY %d~ %d. | remaining %dk over %d rows"
      % (name, y, p, n, tot, gaps))
