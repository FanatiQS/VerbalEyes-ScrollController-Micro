#include <stdio.h>
#include <unistd.h>
#include <sys/select.h>
#include <sys/time.h>
#include <string.h>
#include <stdlib.h>
#include <netdb.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <termios.h>

#include "../../verbalEyes_speed_controller.h"

/*
 * Hotkeys:
 *	Arrow_Up:		Speed up scroll speed
 *	Arrow_Down:		Slow down scroll speed
 *	Arrow_Right:	Network connected
 *	Arrow_Left:		Socket connected (if actual socket is connected)
 */



#define POTMAX 32

bool wifiConnected = 0;
bool socketConnected = 0;
uint16_t potSpeed = 0;

// Reads one character from the standard in if it has anything
int16_t readFromStdIn() {
	unsigned char c = 0;
	read(STDIN_FILENO, &c, 1);

	// Returns character unless it is escape character
	if (c != 0x1B) return c;

	// Gets escaped sequence
	read(STDIN_FILENO, &c, 1);
	if (c != '[') return EOF;
	read(STDIN_FILENO, &c, 1);
	switch (c) {
		// Up
		case 'A': {
			if (potSpeed == POTMAX) break;
			potSpeed++;
			break;
		}
		// Down
		case 'B': {
			if (potSpeed == 0) break;
			potSpeed--;
			break;
		}
		// Right
		case 'C': {
			wifiConnected = !wifiConnected;
			break;
		}
		// Left
		case 'D': {
			if (!wifiConnected) break;
			socketConnected = !socketConnected;
			break;
		}
	}

	return EOF;
}

// Sends a string to config instead of char by char
void updateConfig_str(char* str) {
	while (*str != '\0') {
		updateConfig(*str);
		str++;
	}
}



// Buffer for updated config data
int32_t confFileIndex;
unsigned char confBuffer[CONFIGLEN + 4] = "myWifi";

// Reads a character from the specified address in config buffer
unsigned char verbaleyes_conf_read(const unsigned short addr) {
	return confBuffer[addr];
}

// Writes a character to the specified address in config buffer
void verbaleyes_conf_write(const unsigned short addr, const char c) {
	confBuffer[addr] = c;
}

// Commits changes made to config buffer to file
char* pathToSelf;
void verbaleyes_conf_commit() {
	// Opens self
	FILE* file = fopen(pathToSelf, "r+");

	// Gets to start index for configuration
	fseek(file, confFileIndex, SEEK_SET);

	// Writes configuration content
	for (int i = 0; i < CONFIGLEN; i++) {
		fputc(confBuffer[i], file);
	}

	// Closes file stream
	fclose(file);
}



// Connects to a WiFi network, nothing to be done
void verbaleyes_network_connect(const char* ssid, const char* key) {}

// Gets the fake connection status of the WiFi connection
bool verbaleyes_network_connected() {
	return wifiConnected;
}

// Gets random 32bit value to represent fake ip address
uint32_t verbaleyes_network_getip() {
	srand(clock() * clock());
	return rand();
}



// The tcp socket and its connection status
int sockfd = 0;
bool sockstatus = 0;

// Connects the socket to the endpoint
void verbaleyes_socket_connect(const char* host, const unsigned short port) {
	if (sockfd != 0) close(sockfd);
	if ((sockfd = socket(AF_INET, SOCK_STREAM, 0)) == -1) {
		perror("Unable to create socket\n");
		exit(0);
	}

	struct sockaddr_in servaddr;
	bzero(&servaddr, sizeof(servaddr));
	servaddr.sin_family = AF_INET;
	servaddr.sin_addr.s_addr = inet_addr(host);
	servaddr.sin_port = htons(port);

	sockstatus = !connect(sockfd, (struct sockaddr*)&servaddr, sizeof(servaddr));
}

// Gets the fake and real connection status of the socket connection
bool verbaleyes_socket_connected() {
	return sockstatus && socketConnected;
}

// Consumes a single character from the sockets response data buffer
short verbaleyes_socket_read() {
	// Creates set for select to use with only the socket connected to the host
	fd_set set;
	FD_ZERO(&set);
	FD_SET(sockfd, &set);

	// Creates timeout delay of 0 microseconds
	struct timeval timeout;
    timeout.tv_sec = 0;
    timeout.tv_usec = 0;

	// Checks if socket has data
    switch(select(sockfd + 1, &set, NULL, NULL, &timeout)) {
		// Exits on error
		case -1: {
			perror("ERROR: Select got an error :(");
			exit(EXIT_FAILURE);
		}
		// Returns EOF if socket does not have data
		case 0: {
			return EOF;
		}
		// Reads data and returns it if socket has data
		default: {
			unsigned char c;
			read(sockfd, &c, 1);
			return c;
		}
	}
}

// Sends a packet to the endpoint the socket is connected to
void verbaleyes_socket_write(const uint8_t* packet, const size_t len) {
	write(sockfd, packet, len);
}



// Prints the logs to standard out
bool muteLogs = 0;
void verbaleyes_log(const char* str, const size_t len) {
	if (muteLogs) return;
	printf("%s", str);
	fflush(stdout);
}



// Some kind of raw mode reset
struct termios orig_termios;
void disableRawMode() {
  tcsetattr(STDIN_FILENO, TCSAFLUSH, &orig_termios);
}

// Initializes configuration buffer by reading concatenated config data from self
void initConfStorage() {
	// Gets cached index of buffer in executable
	confFileIndex = (confBuffer[CONFIGLEN + 0] << 24) | (confBuffer[CONFIGLEN + 1] << 16) | (confBuffer[CONFIGLEN + 2] << 8) | (confBuffer[CONFIGLEN + 3] << 0);

	// Exits early if conf is already defined
	if (confFileIndex != 0) return;

	// Opens self
	FILE* file = fopen(pathToSelf, "r+");

	// Gets index of end of buffer in executable
	int i = 0;
	while (i < CONFIGLEN) {
		i = (fgetc(file) == confBuffer[i]) ? i + 1 : 0;
		confFileIndex++;
	}

	// Goes back to start of buffer
	fseek(file, confFileIndex, SEEK_SET);
	confFileIndex -= CONFIGLEN;

	// Write index to file
	fputc((confFileIndex >> 24), file);
	fputc((confFileIndex >> 16) & 0xff, file);
	fputc((confFileIndex >> 8) & 0xff, file);
	fputc((confFileIndex) & 0xff, file);

	// Configure initial configuration
	muteLogs = 1;
	updateConfig_str("host=127.0.0.1\n");
	updateConfig_str("port=8080\n");
	updateConfig_str("path=/\n");
	updateConfig_str("proj=myProject\n");
	updateConfig_str("speedmin=-10\n");
	updateConfig_str("speedmax=10\n");
	confBuffer[266] = POTMAX;
	updateConfig('\n');
	muteLogs = 0;

	// Closes file stream
	fclose(file);
}



//!!
int main(int argc, char** argv) {
	// Sets STDIN to be unbuffered
	tcgetattr(STDIN_FILENO, &orig_termios);
    atexit(disableRawMode);
    struct termios raw = orig_termios;
    raw.c_lflag &= ~(ECHO | ICANON);
	raw.c_cc[VMIN] = 0;
    raw.c_cc[VTIME] = 1;
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw);

	// Gets previous configuration stored in this executable
	pathToSelf = argv[0];
	initConfStorage();

	// Main loop
	while (1) {
		if (updateConfig(readFromStdIn())) continue;
		if (ensureConnection()) continue;
		updateSpeed(potSpeed);
		// jumpToTop(digitalRead(0));
		usleep(20000);
	}
	return 0;
}
