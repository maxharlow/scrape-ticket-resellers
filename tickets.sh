#!/usr/bin/env bash

case $1 in
    'start' )
        SCHEDULE='*/5 * * * *' # every five minutes
        (crontab -l 2> /dev/null; echo "$SCHEDULE PATH=$PATH; cd $(pwd); bash $(basename $0)") | crontab - ;;
    'stop' )
        crontab -l | grep -v $(basename $0) | crontab - ;;
    *)
        node get-me-in &> get-me-in.log &
	node viagogo &> viagogo.log &
	# node stubhub &> stubhub.log &
	# node seatwave &> seatwave.log &
esac
