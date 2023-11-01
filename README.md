# TTTGate
TTTGate is a versatile tool designed to facilitate seamless external access to internal networks. With an easy-to-use server-client setup, it enables secure and efficient communication between external servers and internal PCs behind a NAT. 
![img1](https://github.com/ice3x2/TTTGate/assets/3121298/74e1fed4-59ee-4be4-857c-f622aa5cb679)

## Run Server Mode (External Server):
 1.  Open CLI Interface and Navigate to the bin Directory:
     - Log in to the external server and open the command-line interface (CLI).
     - Navigate to the bin directory of the installed TTTGate software.
       ```shell
       cd /path/to/TTTGate/bin
       ```
 4. Provide execution permissions for the TTTGate files using the following command: (Linux only)
     ```shell
     chmod +x TTTGate*
     ```
 5. Execute `TTTGate-[Your_OS_Name]-[Your_Architecture] server` from this directory.
    ```shell
    ./TTTGate-[Your_OS_Name]-[Your_Architecture] server
    ```
    for Linux
    ```shell
    ./TTTGate-linux-x64 server 
    ```
    for Alpine
    procs beforehand, specifically for Alpine Linux:
    ```shell
    apk add procs
    ./TTTGate-alpine-x64 server
    ```
    for Windows
    ```shell
    TTTGate-win-x64.exe server
    ```
    Available options:
     * `-adminPort [port]`: Changes the port number of the web admin console.
     * `-daemon`: Runs the server in the background mode with process monitoring for automatic restart in case of internal errors.
     * `-reset`: Resets all stored configuration values.
  6. Access Web Admin Console:
     - After successful execution, open a web browser.
     - Enter the external server's IP address followed by the port number 9300 (e.g., http://your_server_ip:9300). You should now be able to access the web admin console.
    
## Run Client Mode (Internal PC):
   1.  Open CLI Interface and Navigate to the bin Directory:
     - Log in to the external server and open the command-line interface (CLI).
     - Navigate to the bin directory of the installed TTTGate software.
       ```shell
       cd /path/to/TTTGate/bin
       ```
  4. Provide execution permissions for the TTTGate files using the following command: (Linux only)
     ```shell
     chmod +x TTTGate* 
     ```
  1. Execute `TTTGate-[Your_OS_Name]-[Your_Architecture] client -addr [server address]` from this directory.
     ```shell
     ./TTTGate-[Your_OS_Name]-[Your_Architecture] client -addr [server_address]
     ```
     Please [server_address] with the server address in the format of [hostname]:[port_number]. If the port number is the default 9126 and has not been changed on the server, you can simply enter the hostname.
     for Linux
     ```shell
     ./TTTGate-linux-x64 client -addr hostname 
     ```
     for Alpine
     procs beforehand, specifically for Alpine Linux:
     ```shell
     apk add procs
     ./TTTGate-alpine-x64 client -addr hostname 
     ```
     for Windows
     ```shell
     TTTGate-win-x64.exe client -addr hostname 
     ```
     Available options:
       * `-tls`: Enables communication with the server using Transport Layer Security (TLS) when TLS is enabled in the web admin console. default false.
       * `-name`: Defines the client name. default random name.
       * `-key`: Defines the authentication key, which must match the one set in the web admin console. The default value is the same for both the server and the client, so it does not need to be set separately.
       * `-daemon`: Operates in the background mode. Process monitoring is also active, enabling automatic restart in the event of the server process being forcibly terminated due to internal errors.
       * `-bufferLimit`: [limit size]: Specifies the buffer size limit in mebibytes (MiB). Default 128MiB.
       * `-save`: Saves the options.
     
    
