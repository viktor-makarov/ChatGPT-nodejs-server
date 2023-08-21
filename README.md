# README #

This is a Telegram chatbot that utilizes the OpenAI API. The chatbot is built on Node.js using the node-telegram-bot-api module and employs mongodb as its database.

## Main features ##

* The chatbot has four modes: "assistant" for dialogue and three additional modes ("coderevier," "texteditor," and "translator") for preset tasks.
* Users can send tasks to the chatbot using both text messages and voice messages. The voice messages are first transcribed using the Whisper technology from OpenAI. In addition to voice messages, users can also send Telegram video notes and other audio and video recordings, as long as they do not exceed 25 Mb in size.
* The chatbot also offers a voice-to-text mode where users can send audio files (with a maximum size of 25 Mb) and receive the text, thanks to the Whisper technology from OpenAI.
* It also includes an admin mode with advanced options, such as sending messages to all users with /senttome and /sendtoall commands and generating usage reports with /reports command.
* The chatbot handles user registration through a registration_key specified in the config. Admin privileges can be obtained by submitting an admin_key.
* It effectively handles OpenAI's replies in stream mode, so users start receiving replies soon after the request.
* The chatbot can process incoming and outgoing messages as one message, even if they exceed 4000 characters.
* Users can regenerate completions using an inline keyboard button.
* Markdown formatting is applied to completions.
* The chatbot logs errors, user registration events, and token usage to its database which enables the admin to request respective reports.
* Users can modify request settings using the /settings command, enabling them to choose the temperature and model parameters. 


## ISSUES ##
* Incorrect token count of prompts. The chatbot uses the stream functionality of the OpenAI API to receive responses token by token, allowing users to receive responses quickly. However, this functionality does not provide a token count for the prompt or completion. Therefore, we need to implement our own counting method. Counting tokens for completions is straightforward, as each token is receoved separately. The main issue arises with the prompt. According to OpenAI documentation, we use the `gpt-3-encoder` tokenizer. However, if we send a request in a language other than English, it is internally translated into English on API side for further processing, including token counting. Unfortunately, we cannot apply the same trick and must tokenize the initial language, resulting in a different token count. For example, for Russian, the number of tokens is about 2.5 times higher than would be for it's English version. In conclusion, the token count for non-English prompts is always incorrect.


## TO DO ##
* Fix the issue of inaccurate token count specifically in relation to prompts.
* Conduct thorough testing of the recently introduced functions feature to ensure.

## How do I get set up for production? ##

### Prerequisites ###
* Register on OpenAI to obtain your OpenAI API key.
* Create a chatbot on Telegram and obtain your Telegram Bot Token.
* Generate two random keys for the REGISTRATION_KEY and ADMIN_KEY.
* Ensure that Docker and Docker Compose are installed on your machine.

### Run chatbot ###
* Clone the repository to your local machine
* Rename `docker-compose.yml.prod` to `docker-compose.yml`.
* Create a `.env` file in the root of the project and set the values for for `TELEGRAM_BOT_TOKEN_PROD`,`OPENAI_API_KEY`, `REGISTRATION_KEY_PROD`,  `ADMIN_KEY_PROD` and `MONGODB_CONNECTION_PROD`.
* Set up external ports for MongoDB so that you could connect to it from external tools like Compass.
* Start Docker Compose to run the chatbot. In this case you will be set up with my docker container. If you wish to adjust the config files to your requrements - refer to the the following development section.
* Verify the functionality of your Telegram chatbot.
* Connect to your mongodb instanse and create a user that the chatbot will connect to the database with and grant nesessary permissions.
* In your `docker-compose.yml`, add ```command: [--auth]``` to the chatbot-mongo-db service. In `.env`, adjust the variable `MONGODB_CONNECTION_PROD` to include authentication credentials of the newly created user.
* Restart docker-compose. Now you have secured your MongoDB from unauthorized access.

## How do I get set up for development? ##

### Prerequisites ###

Before starting the development process, make sure you have the following prerequisites

* Node.js and NPM installed on your machine
* All the requirements mentioned in the production setup section are met
* Create an additional Telegram chatbot for development purposes, as you cannot use the same chatbot for both production and development environments.

### Run development environment ###

Follow these steps to start the development process:

* Create or add to `.env` file in the root of the project the values for `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, `REGISTRATION_KEY`, `ADMIN_KEY` and `MONGODB_CONNECTION_DEV`. They will be used in development mode. So, in your `.env` will live environmental parameters both for dev and prod, but in isolated variables.
* In the `docker-compose.yml` file, uncomment the `chatbot-preprod-mongo-db` service and the corresponding volume and network configurations. This will provide a separate MongoDB instance for development purposes, isolating it from the production environment.
* Rename `config/main_config.yml.prod` to `config/main_config.yml` and agjust if needed.
*  other files in the `config` directory to meet your requirements.
* *(Optional)* Read and adjust the other files in the `config` folder according to your specific requirements.
* Restart Docker Compose to initiate the development MongoDB by executing:```docker-compose restart```
* Once the development MongoDB is up and running, you can start the project live and confirm its functionality by running the following command:
```npm start```
* After all you changes, build a new image and put it into production by adjusting the docker-compuse.yml `image` parameter.

## Contribution guidelines ##

Welcome to the project! We appreciate your interest and value your contributions. To ensure a smooth collaboration experience, please follow these guidelines when making contributions.

### Issue Reporting ###

- Before submitting a new issue, please search through existing issues to check if the same or a similar issue has already been reported.
- Use the github issue template provided to accurately describe the problem or bug you encountered.
- Include relevant details such as operating system, browser version, and steps to reproduce the issue.

#### Pull Requests ###

- Fork the repository and create a new branch for your feature or bug fix.
- Provide a clear and concise description of the changes made in the pull request.
- Include relevant tests if applicable.
- Review your own changes before submitting the pull request.

### License ###

- This project is destributed under MIT License. It requires including the original license and copyright notice in derivative works.
- By contributing to this project, you agree to license your contributions under the project's chosen license.

Please note that project maintainers reserve the right to refuse or remove contributions that do not adhere to these project goals.

Thank you for your contributions and happy coding!

## Release notes ##

### Version 1.0.0 - Initial Release - July 09, 2023

#### Features

* The chatbot has four modes: "assistant" for dialogue and three additional modes ("coderevier," "texteditor," and "translator") for preset tasks.
* Users can send tasks to the chatbot using both text messages and voice messages. The voice messages are first transcribed using the Whisper technology from OpenAI. In addition to voice messages, users can also send Telegram video notes and other audio and video recordings, as long as they do not exceed 25 Mb in size.
* The chatbot also offers a voice-to-text mode where users can send audio files (with a maximum size of 25 Mb) and receive the corresponding text, thanks to the Whisper technology from OpenAI.
* It also includes an admin mode with advanced options, such as sending messages to all users with /senttome and /sendtoall commands and generating usage reports with /reports command.
* The chatbot handles user registration through a registration_key specified in the config. Admin privileges can be obtained by submitting an admin_key.
* It effectively handles OpenAI's replies in stream mode, so users start receiving replies soon after the request.
* The chatbot can process incoming and outgoing messages as one message, even if they exceed 4000 characters.
* Users can regenerate completions using an inline keyboard button.
* Markdown formatting is applied to completions.
* The chatbot logs errors, user registration events, and token usage to its database which enables the admin to request respective reports.
* Users can modify request settings using the /settings command, enabling them to choose the temperature and model parameters. 