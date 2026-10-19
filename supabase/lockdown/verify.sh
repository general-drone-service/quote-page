#!/usr/bin/env bash
# DRO-980 #55 HTTP check for migrations 005–007. Prints status codes and counts only: no key, no row, no file name.
#   bash supabase/lockdown/verify.sh             # before: the anon section is expected to FAIL
#   AFTER=1 bash supabase/lockdown/verify.sh     # after: also tries an anon upload to cleaning-photos
# Asks for the project's anon key (hidden input). Optional:
#   PDF_URL=<a pdf_url a customer already received>   checked with HEAD only (status code, no download)
#   LOOKUP_TOKEN=<QUOTE_LOOKUP_TOKEN>                  once quote-page #12 is deployed
set -u
SUPA=${SUPA:-https://tlagzxaasnpwqnmeorbs.supabase.co}
QUOTE=${QUOTE:-https://quote.drone168.com}
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
skip() { echo "SKIP  $1"; }
# Only a permission refusal counts as blocked: 000 (curl failed), 5xx or any other status cannot prove it
denied() { case $1 in 401|403) return 0;; *) return 1;; esac; }

if [ -z "${ANON_KEY:-}" ]; then read -rs -p "anon key: " ANON_KEY; echo; fi
H=(-H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")

echo "-- part 1/2: anon cannot reach the tables"
for t in quotes quote_drafts pricing_params knowledge_chunks chat_history bot_pause pricing_params_audit; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$SUPA/rest/v1/$t?select=*&limit=0" "${H[@]}")
  denied "$c" && pass "anon $t -> $c" || fail "anon $t -> $c"
done
vec=$(python3 -I -c 'print("[" + ",".join(["0"] * 1024) + "]")')
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$SUPA/rest/v1/rpc/match_knowledge" "${H[@]}" -H 'content-type: application/json' \
  -d "{\"query_embedding\":\"$vec\",\"match_count\":0,\"match_threshold\":2}")
# PostgREST answers 404 (PGRST202) for a function the role may not execute
case $c in 401|403|404) pass "anon rpc match_knowledge -> $c";; *) fail "anon rpc match_knowledge -> $c";; esac

echo "-- part 3: anon cannot list quote-pdfs; customer links still open"
r=$(curl -s -w ' %{http_code}' -X POST "$SUPA/storage/v1/object/list/quote-pdfs" "${H[@]}" -H 'content-type: application/json' -d '{"prefix":"quotes","limit":5}')
c=${r##* }
# list is filtered by RLS: closed means HTTP 200 with an empty JSON array; anything else cannot prove it
n=$(printf '%s' "${r% *}" | python3 -I -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: print("invalid"); sys.exit()
print(len(d) if isinstance(d,list) else "invalid")')
if [ "$c" = 200 ] && [ "$n" = 0 ]; then pass "anon list quote-pdfs -> 200, 0 entries"
elif [ "$c" = 200 ] && [ "$n" != invalid ]; then fail "anon list quote-pdfs -> $n entries visible"
else fail "anon list quote-pdfs -> $c, cannot verify"; fi
if [ -n "${PDF_URL:-}" ]; then
  c=$(curl -s -o /dev/null -I -w '%{http_code}' "$PDF_URL")
  [ "$c" = 200 ] && pass "existing customer PDF link -> 200" || fail "existing customer PDF link -> $c"
else
  skip "existing customer PDF link (set PDF_URL)"
fi

echo "-- part 4: anon cannot write to cleaning-photos"
if [ "${AFTER:-}" = 1 ]; then
  p="lockdown-check/$(python3 -I -c 'import uuid;print(uuid.uuid4())').jpg"
  r=$(curl -s -w ' %{http_code}' -X POST "$SUPA/storage/v1/object/cleaning-photos/$p" "${H[@]}" -H 'content-type: image/jpeg' --data-binary 'lockdown check')
  c=${r##* }
  case $c in
    2??)
      fail "anon upload to cleaning-photos -> $c (still writable)"
      curl -s -o /dev/null -X DELETE "$SUPA/storage/v1/object/cleaning-photos/$p" "${H[@]}";;
    # Storage reports an RLS refusal as 400/403 with "row-level security" in the body
    400|403)
      [[ $r == *row-level\ security* ]] && pass "anon upload to cleaning-photos -> $c (RLS refused)" \
        || fail "anon upload to cleaning-photos -> $c, not an RLS refusal: cannot verify";;
    *) fail "anon upload to cleaning-photos -> $c, cannot verify";;
  esac
else
  skip "anon upload test (writes while the policy is still open; run with AFTER=1)"
fi
unset ANON_KEY H

echo "-- apps on the service role still work"
r=$(curl -s -w ' %{http_code}' "$QUOTE/api/pricing-params")
# the route falls back to built-in defaults on a DB error
[[ $r == *' 200' && $r != *'"source":"default"'* ]] && pass "quote-page reads pricing_params" || fail "quote-page reads pricing_params (${r: -3}, default fallback?)"
auth=()
[ -n "${LOOKUP_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $LOOKUP_TOKEN")
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$QUOTE/api/quote/lookup" -H 'content-type: application/json' ${auth[@]+"${auth[@]}"} -d '{"quoteCode":"Q-19000101-000"}')
case $c in
  404) pass "quote-page reads quotes (unknown code -> 404)";;
  401|503) skip "quote lookup needs LOOKUP_TOKEN after quote-page #12 ($c)";;
  *) fail "quote-page reads quotes -> $c (500 = DB denied)";;
esac
unset LOOKUP_TOKEN

echo "-- manual, with test data (see README)"
[ $fails -eq 0 ] && echo "ALL PASS" || { echo "$fails FAILED"; exit 1; }
