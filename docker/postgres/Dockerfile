FROM postgres:18-bookworm

# The authorized Rishabh Plastic export contains legacy PostgreSQL `money`
# values formatted with the Indian-rupee currency symbol.  PostgreSQL parses
# those values using LC_MONETARY, so the lower-environment image must include
# the locale used by the original system.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends locales \
  && sed -i 's/^# \(en_IN UTF-8\)/\1/' /etc/locale.gen \
  && locale-gen en_IN \
  && rm -rf /var/lib/apt/lists/*

ENV LANG=en_IN.utf8 \
    LC_ALL=en_IN.utf8
