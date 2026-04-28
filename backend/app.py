from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route('/', methods=['GET'])
def home():
    return jsonify({"message": "CopyGit Backend is running!"})

# This is for UptimeRobot
@app.route('/ping', methods=['GET'])
def ping():
    return "pong", 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)