#!/usr/bin/env bash

case $1 in
    'start' )
        SCHEDULE='*/5 * * * *' # every five minutes
        (crontab -l 2> /dev/null; echo "$SCHEDULE PATH=$PATH; cd $(pwd); bash $(basename $0)") | crontab - ;;
    'stop' )
        crontab -l | grep -v $(basename $0) | crontab - ;;
    *)
        node get-me-in &> get-me-in-$(date +%Y%m%d).log &
	node viagogo &> viagogo-$(date +%Y%m%d).log &
	node stubhub &> stubhub-$(date +%Y%m%d).log &
	# node seatwave &> seatwave-$(date +%Y%m%d).log &
esac
