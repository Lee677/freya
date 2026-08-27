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
marks = [re.findall(r'class="mk (\w+)"', r) for r in rows]
assert all(len(m) == 3 for m in marks), "every row carries three marks"
fy = [m[-1] for m in marks]
tot = sum(int(x) for x in re.findall(r'class="num">(\d+)k<', s))
gaps = len(re.findall(r'class="num">\d+k<', s))
y, p, n = fy.count("yes"), fy.count("partial"), fy.count("no")

# ALL THREE cards are recomputed, not just freyacad's, and so is the "(of N)"
# beside them. They used to drift: a 76th row was added, only the freyacad card
# was recomputed, and the other two stayed a row light behind a label still
# reading "(of 75)". Counting them here is the same reason the tallies were
# taken out of hand-editing in the first place.
for cls, col in (("sw", 0), ("fc", 1), ("fy", 2)):
    cm = [m[col] for m in marks]
    cy, cp, cn = cm.count("yes"), cm.count("partial"), cm.count("no")
    s = re.sub(r'(tcard %s.*?nums">)<b>\d+</b>(\s*✅\s*&nbsp;·&nbsp;\s*)<b>\d+</b>'
               r'(\s*◐\s*&nbsp;·&nbsp;\s*)<b>\d+</b>(\s*❌\s*&nbsp;\(of )\d+(\))' % cls,
               lambda m: '%s<b>%d</b>%s<b>%d</b>%s<b>%d</b>%s%d%s'
                         % (m.group(1), cy, m.group(2), cp, m.group(3), cn,
                            m.group(4), len(rows), m.group(5)),
               s, count=1, flags=re.S)
s = re.sub(r'<b>~[\d.]+M</b> output tokens &nbsp;·&nbsp; \d+ items',
           '<b>~%.2fM</b> output tokens &nbsp;·&nbsp; %d items' % (tot / 1000.0, gaps), s)

io.open(F, "w", encoding="utf-8", newline="").write(s)
print("%s -> done | freyacad %dY %d~ %d. of %d | remaining %dk over %d rows"
      % (name, y, p, n, len(rows), tot, gaps))
